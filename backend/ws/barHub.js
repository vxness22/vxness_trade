import { WebSocketServer } from 'ws'
import barAggregator, { TIMEFRAMES } from '../services/barAggregator.js'

// Native WebSocket hub for live OHLC bar updates — the vxness counterpart of
// SwisDex's gateway /ws/bars (bar_stream). Attaches to the existing HTTP server
// on the `/ws/bars` path, alongside Socket.IO (which lives on /socket.io/), so
// the two never collide.
//
// Wire protocol (mirrors frontend/src/services/barSocket.js):
//   client → server: {"type":"subscribe","symbol":"XAUUSD","resolution":"5"}
//                    {"type":"unsubscribe","symbol":"XAUUSD","resolution":"5"}
//                    {"type":"ping"}
//   server → client: {"type":"subscribed","symbol":"XAUUSD","resolution":"5"}
//                    {"type":"bar_update","symbol":"XAUUSD","resolution":"5",
//                     "bar":{"time":1731000000,"open":...,"high":...,...}}
//                    {"type":"pong"}
//                    {"type":"ping"}   // server keep-alive every 30s
//
// `bar.time` is bar-START in epoch SECONDS. The TradingView datafeed multiplies
// by 1000 for milliseconds.

// TradingView resolution → internal timeframe key. Non-base resolutions
// (3/10/45/120/180/W/M) are aggregated CLIENT-SIDE by the charting library from
// their base, so the datafeed only ever subscribes with a base resolution — but
// we map the aggregated ones to their base building block just in case.
const RES_TO_TF = {
  '1': '1m', '3': '1m',
  '5': '5m', '10': '5m',
  '15': '15m', '45': '15m',
  '30': '30m',
  '60': '1h', '120': '1h', '180': '1h',
  '240': '4h',
  'D': '1d', '1D': '1d', 'W': '1d', '1W': '1d', 'M': '1d', '1M': '1d',
}

function normaliseRes(resolution) {
  const r = String(resolution)
  if (TIMEFRAMES[r]) return r // already a tf key ('5m', '1h', ...)
  return RES_TO_TF[r] || null
}

export function initBarHub(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/bars' })

  const send = (ws, payload) => {
    if (ws.readyState !== ws.OPEN) return
    try { ws.send(JSON.stringify(payload)) } catch { /* ignore */ }
  }

  wss.on('connection', (ws) => {
    // Per-connection subscriptions: key `${SYMBOL}:${originalResolution}` ->
    // { symbol, res, tf }. We echo back the SAME resolution string the client
    // subscribed with so its listener key matches.
    ws.subs = new Map()

    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (!msg || typeof msg !== 'object') return

      if (msg.type === 'subscribe' && msg.symbol && msg.resolution != null) {
        const symbol = String(msg.symbol).toUpperCase()
        const res = String(msg.resolution)
        const tf = normaliseRes(res)
        if (!tf) return
        const key = `${symbol}:${res}`
        ws.subs.set(key, { symbol, res, tf })
        send(ws, { type: 'subscribed', symbol, resolution: res })
        // Push the current in-progress bar immediately so the candle is live
        // without waiting for the next tick.
        const cur = barAggregator.getCurrent(symbol, tf)
        if (cur) send(ws, { type: 'bar_update', symbol, resolution: res, bar: cur })
      } else if (msg.type === 'unsubscribe' && msg.symbol && msg.resolution != null) {
        const key = `${String(msg.symbol).toUpperCase()}:${String(msg.resolution)}`
        ws.subs.delete(key)
      } else if (msg.type === 'ping') {
        send(ws, { type: 'pong' })
      }
    })

    ws.on('close', () => { ws.subs?.clear() })
    ws.on('error', () => { try { ws.close() } catch { /* ignore */ } })
  })

  // Real-time: fan every aggregated tick-bar out to the clients that want it.
  barAggregator.on('bar', (symbol, tf, bar) => {
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN || !ws.subs) continue
      for (const sub of ws.subs.values()) {
        if (sub.symbol === symbol && sub.tf === tf) {
          send(ws, { type: 'bar_update', symbol, resolution: sub.res, bar })
        }
      }
    }
  })

  // Heartbeat: re-push the current bar for every active subscription each second
  // so quiet symbols (e.g. weekend forex) still open/close bars on time.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN || !ws.subs) continue
      for (const sub of ws.subs.values()) {
        const cur = barAggregator.getCurrent(sub.symbol, sub.tf)
        if (cur) send(ws, { type: 'bar_update', symbol: sub.symbol, resolution: sub.res, bar: cur })
      }
    }
  }, 1000)

  // App-level keep-alive so proxies don't drop idle chart sockets.
  setInterval(() => {
    for (const ws of wss.clients) send(ws, { type: 'ping' })
  }, 30000)

  console.log('[BarHub] /ws/bars WebSocket ready')
  return wss
}

export default initBarHub
