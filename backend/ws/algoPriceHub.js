import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import AlgoKey, { hashSecret } from '../models/AlgoKey.js'
import TradingAccount from '../models/TradingAccount.js'
import infowayService, { SUPPORTED_SYMBOLS } from '../services/infowayService.js'
import { loadSpreadTable, applySpread } from '../utils/terminalQuotes.js'

// Live tick stream for the desktop terminal, on /ws/algo/prices.
//
// Wire protocol (see core/PriceStream.cpp):
//   client → {"action":"auth","api_key":…,"api_secret":…}   (or {"token":…})
//   server → {"status":"authenticated","account":"12345678"}
//   server → {"type":"tick","symbol":…,"bid":…,"ask":…,"spread":…,"timestamp":…}
//   server → {"type":"ping"}          client → {"type":"pong"}
//
// Quotes carry the account's admin spread, exactly as /api/algo/prices and the
// web terminal render them — one account must never show two different asks
// depending on which client is open.

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

// Nothing is streamed until the first message authenticates. A socket that
// just sits there is dropped rather than held open indefinitely.
const AUTH_GRACE_MS = 10_000
const PING_INTERVAL_MS = 30_000
const SPREAD_REFRESH_MS = 60_000
// Infoway can push a symbol many times a second; 80ms per symbol is well past
// the point a human eye or a forming candle can tell the difference.
// Coalescing window. Each flush sends the LATEST quote per symbol that changed
// since the last one — never a backlog, never a per-symbol drop.
//
// The old behaviour throttled each symbol to one tick per 80ms and DISCARDED
// anything arriving inside that window, then wrote one frame per symbol per
// tick. With a fast feed that is a lot of small writes, and whichever symbol
// ticked first inside a window won while the others waited their turn. Keeping
// the newest per symbol and writing one frame per flush costs the same whatever
// the feed does, and 50ms is under the threshold anyone can see.
const FLUSH_MS = 50

export function initAlgoPriceHub(httpServer) {
  // noServer + manual routing, for the same reason barHub.js uses it: passing
  // { server, path } makes ws abortHandshake(400) every upgrade on another
  // path, which would kill Socket.IO's /socket.io/ transport and the /ws/bars
  // hub along with it.
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/'
    try { pathname = new URL(req.url, 'http://localhost').pathname } catch { pathname = (req.url || '').split('?')[0] }
    if (pathname !== '/ws/algo/prices') return // not ours
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req) })
  })

  const send = (ws, payload) => {
    if (ws.readyState !== ws.OPEN) return
    try { ws.send(JSON.stringify(payload)) } catch { /* ignore */ }
  }

  async function authenticate(msg) {
    if (msg.api_key && msg.api_secret) {
      const key = await AlgoKey.findOne({ apiKey: String(msg.api_key), revoked: false })
      if (!key || key.secretHash !== hashSecret(msg.api_secret)) return null
      const account = await TradingAccount.findById(key.tradingAccountId).populate('accountTypeId')
      if (!account) return null
      return { userId: key.userId, account }
    }

    if (msg.token) {
      let decoded
      try {
        decoded = jwt.verify(String(msg.token), JWT_SECRET)
      } catch {
        return null
      }
      // With only a JWT there is no account in the credential; use the user's
      // most recent one so the stream still has a spread table to apply.
      const account = await TradingAccount.findOne({
        userId: decoded.id, status: { $ne: 'Archived' },
      }).populate('accountTypeId').sort({ createdAt: -1 })
      if (!account) return null
      return { userId: decoded.id, account }
    }

    return null
  }

  wss.on('connection', (ws) => {
    ws.authed = false
    ws.spreadTable = null

    const graceTimer = setTimeout(() => {
      if (!ws.authed) {
        send(ws, { type: 'error', message: 'Authentication timed out' })
        try { ws.close() } catch { /* ignore */ }
      }
    }, AUTH_GRACE_MS)

    let spreadTimer = null

    ws.on('message', async (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (!msg || typeof msg !== 'object') return

      if (msg.type === 'pong') return

      if (msg.action === 'auth') {
        if (ws.authed) return
        let session = null
        try {
          session = await authenticate(msg)
        } catch (e) {
          console.error('[AlgoPriceHub] auth error:', e.message)
        }

        if (!session) {
          send(ws, { status: 'error', message: 'Invalid credentials' })
          try { ws.close() } catch { /* ignore */ }
          return
        }

        clearTimeout(graceTimer)
        ws.authed = true
        ws.session = session

        try {
          ws.spreadTable = await loadSpreadTable(
            session.userId, session.account.accountTypeId?._id, SUPPORTED_SYMBOLS
          )
        } catch (e) {
          console.error('[AlgoPriceHub] spread table failed:', e.message)
          ws.spreadTable = new Map()
        }

        // Admin can change spreads mid-session; re-resolve periodically so the
        // stream does not keep quoting a rule that has been withdrawn.
        spreadTimer = setInterval(async () => {
          if (ws.readyState !== ws.OPEN) return
          try {
            ws.spreadTable = await loadSpreadTable(
              session.userId, session.account.accountTypeId?._id, SUPPORTED_SYMBOLS
            )
          } catch { /* keep the previous table */ }
        }, SPREAD_REFRESH_MS)

        send(ws, { status: 'authenticated', account: session.account.accountId })

        // Prime the watchlist immediately instead of waiting for each symbol's
        // next tick — a quiet market would otherwise show an empty table.
        for (const symbol of SUPPORTED_SYMBOLS) {
          const p = infowayService.getPrice(symbol)
          if (!p || !(p.bid > 0)) continue
          const q = applySpread(symbol, p.bid, p.ask, ws.spreadTable.get(symbol))
          send(ws, {
            type: 'tick',
            symbol,
            bid: q.bid,
            ask: q.ask,
            spread: q.ask - q.bid,
            timestamp: new Date(p.time || Date.now()).toISOString(),
          })
        }
      }
    })

    ws.on('close', () => {
      clearTimeout(graceTimer)
      if (spreadTimer) clearInterval(spreadTimer)

    })
    ws.on('error', () => { try { ws.close() } catch { /* ignore */ } })
  })

  // One subscription to the feed, coalesced, then fanned out to every
  // authenticated socket on a fixed frame.
  const pending = new Map() // symbol -> newest raw quote since the last flush

  infowayService.subscribe((symbol, price) => {
    if (!(price?.bid > 0)) return
    pending.set(symbol, price)
  })

  setInterval(() => {
    if (pending.size === 0) return

    // Drain first: a quote arriving while this loop runs belongs to the NEXT
    // frame, not to a half-sent one.
    const batch = [...pending.entries()]
    pending.clear()

    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN || !ws.authed) continue
      for (const [symbol, price] of batch) {
        // Spread is per-account, so it is applied per socket rather than once.
        const q = applySpread(symbol, price.bid, price.ask, ws.spreadTable?.get(symbol))
        send(ws, {
          type: 'tick',
          symbol,
          bid: q.bid,
          ask: q.ask,
          spread: q.ask - q.bid,
          timestamp: new Date(price.time || Date.now()).toISOString(),
        })
      }
    }
  }, FLUSH_MS)

  // App-level keep-alive: the terminal answers {"type":"pong"}, and proxies see
  // traffic on an otherwise idle weekend socket.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN && ws.authed) send(ws, { type: 'ping' })
    }
  }, PING_INTERVAL_MS)

  console.log('[AlgoPriceHub] /ws/algo/prices WebSocket ready')
  return wss
}

export default initAlgoPriceHub
