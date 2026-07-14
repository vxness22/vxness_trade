// Singleton WebSocket client for live OHLC bar updates from the backend.
// Faithful port of SwisDex's lib/ws/barSocket.ts, in plain JS for vxness.
//
// Connects to /ws/bars and forwards server-pushed `bar_update` events to
// registered listeners filtered by (symbol, resolution).
//
// Wire protocol mirrors the server hub at backend/ws/barHub.js:
//   client → server: {"type":"subscribe","symbol":"XAUUSD","resolution":"5"}
//                    {"type":"unsubscribe","symbol":"XAUUSD","resolution":"5"}
//                    {"type":"ping"}
//   server → client: {"type":"bar_update","symbol":"XAUUSD","resolution":"5",
//                     "bar":{"time":1731000000,"open":...,"high":...,...}}
//                    {"type":"pong"} / {"type":"subscribed",...} / {"type":"ping"}
//
// `bar.time` is bar-START in epoch SECONDS. The datafeed converts to ms.
import { API_BASE_URL } from '../config/api'

// Origin (scheme + host, no path) for the bar WebSocket, derived from the API
// base URL: http→ws, https→wss.
function getWsBaseUrl() {
  try {
    const u = new URL(API_BASE_URL)
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${u.host}`
  } catch {
    return String(API_BASE_URL).replace(/^http/i, 'ws').replace(/\/$/, '')
  }
}

class BarSocket {
  constructor() {
    this.ws = null
    this.listeners = new Map() // key `${SYMBOL}:${resolution}` -> Set<entry>
    this.connecting = false
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.pingTimer = null
    this.maxReconnectAttempts = 50
    this._everConnected = false
    this._reconnectListeners = new Set()
  }

  /** Register a callback fired after the socket RE-connects. Returns unsub. */
  onReconnect(cb) {
    this._reconnectListeners.add(cb)
    return () => this._reconnectListeners.delete(cb)
  }

  subKey(symbol, resolution) {
    return `${String(symbol).toUpperCase()}:${resolution}`
  }

  connect() {
    if (this.connecting) return
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    this.connecting = true

    let ws
    try {
      ws = new WebSocket(`${getWsBaseUrl()}/ws/bars`)
    } catch {
      this.connecting = false
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.connecting = false
      const wasReconnect = this._everConnected
      this._everConnected = true
      this.reconnectAttempts = 0
      // Re-subscribe to everything any chart is currently asking for.
      for (const key of this.listeners.keys()) {
        const idx = key.lastIndexOf(':')
        const symbol = key.slice(0, idx)
        const resolution = key.slice(idx + 1)
        this.send({ type: 'subscribe', symbol, resolution })
      }
      this.startPing()
      if (wasReconnect) {
        for (const cb of this._reconnectListeners) {
          try { cb() } catch { /* listener errors must not break the socket */ }
        }
      }
    }

    ws.onmessage = (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      if (msg && msg.type === 'bar_update' && msg.symbol && msg.resolution != null && msg.bar) {
        const key = this.subKey(msg.symbol, msg.resolution)
        const set = this.listeners.get(key)
        if (!set) return
        for (const entry of set) {
          try { entry.callback(msg.bar) } catch { /* ignore */ }
        }
      }
    }

    ws.onclose = () => {
      this.connecting = false
      this.stopPing()
      this.ws = null
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      try { ws.close() } catch { /* ignore */ }
    }
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try { this.ws.send(JSON.stringify(payload)) } catch { /* reconnect replays subs */ }
  }

  startPing() {
    this.stopPing()
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25000)
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return
    if (this.reconnectTimer) return
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /** Listen for bar updates on (symbol, resolution). Returns an unsubscribe fn. */
  subscribe(symbol, resolution, callback) {
    const res = String(resolution)
    const key = this.subKey(symbol, res)
    const entry = { key, symbol: String(symbol).toUpperCase(), resolution: res, callback }
    let set = this.listeners.get(key)
    const wasEmpty = !set || set.size === 0
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(entry)

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect()
    }
    if (wasEmpty && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', symbol: entry.symbol, resolution: entry.resolution })
    }

    return () => {
      const s = this.listeners.get(key)
      if (!s) return
      s.delete(entry)
      if (s.size === 0) {
        this.listeners.delete(key)
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.send({ type: 'unsubscribe', symbol: entry.symbol, resolution: entry.resolution })
        }
      }
    }
  }
}

export const barSocket = new BarSocket()
export default barSocket
