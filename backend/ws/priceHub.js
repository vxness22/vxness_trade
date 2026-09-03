// /ws/prices — the live quote stream the mobile app has always tried to open.
//
// The app has had this client code all along (services/websocket/
// WebSocketService.js) but the server never served the path: the upgrade was
// answered with a 404 and the app quietly fell back to polling
// GET /instruments/prices/all every two seconds. So however fast the feed ran,
// a phone saw a new price twice a second at best — none of the work on the feed
// or the forwarding reached it.
//
// Message shape is the one that client already parses — {symbol, bid, ask, time}
// one symbol per frame — so an APK already in someone's hands starts receiving
// live ticks the moment this deploys, with no update.
//
// Unauthenticated, like the Socket.IO 'prices' room the website uses: these are
// public quotes, and nothing here reads or writes account state.

import { WebSocketServer } from 'ws'
import infowayService from '../services/infowayService.js'

const PATH = '/ws/prices'

// Same 50ms frame as the other hubs: keep the newest quote per symbol and send
// on a fixed beat, so the cost is set by how many symbols moved rather than by
// how fast the feed happens to be running.
const FLUSH_MS = 50

export function initPriceHub(httpServer) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/'
    try { pathname = new URL(req.url, 'http://localhost').pathname }
    catch { pathname = (req.url || '').split('?')[0] }
    // Every hub shares this server, so each one must ignore paths that are not
    // its own and leave them for the next listener.
    if (pathname !== PATH) return
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws) => {
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    ws.on('error', () => { try { ws.close() } catch { /* ignore */ } })

    // Prime the client with everything known right now, so a watchlist is
    // populated on open instead of filling in as each symbol happens to tick.
    try {
      const all = infowayService.getAllPrices()
      for (const [symbol, p] of Object.entries(all)) {
        if (!(p?.bid > 0)) continue
        ws.send(JSON.stringify({ symbol, bid: p.bid, ask: p.ask, time: p.time || Date.now() }))
      }
    } catch { /* a failed prime is not worth dropping the connection over */ }
  })

  const pending = new Map()
  infowayService.subscribe((symbol, price) => {
    if (!(price?.bid > 0)) return
    pending.set(symbol, price)
  })

  setInterval(() => {
    if (pending.size === 0 || wss.clients.size === 0) { pending.clear(); return }

    // Drain before sending: a quote arriving mid-flush belongs to the next frame.
    const batch = [...pending.entries()]
    pending.clear()

    // Serialised once for every client rather than once per client — with a
    // couple of hundred updates a second the JSON is the expensive part.
    const frames = batch.map(([symbol, p]) =>
      JSON.stringify({ symbol, bid: p.bid, ask: p.ask, time: p.time || Date.now() }))

    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue
      for (const f of frames) {
        try { ws.send(f) } catch { /* a dead socket is cleaned up by the heartbeat */ }
      }
    }
  }, FLUSH_MS)

  // Drop sockets that stopped answering, or a phone that lost signal would sit
  // in wss.clients forever and be written to on every frame.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate() } catch { /* ignore */ } ; continue }
      ws.isAlive = false
      try { ws.ping() } catch { /* ignore */ }
    }
  }, 30000)

  console.log(`[PriceHub] ${PATH} WebSocket ready`)
  return wss
}

export default initPriceHub
