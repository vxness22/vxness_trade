// Institutional-grade real-time price streaming service using Socket.IO
import { io } from 'socket.io-client'
import { API_BASE_URL } from '../config/api'
import { pnlUsd } from '../utils/margin'

const SOCKET_URL = API_BASE_URL

class PriceStreamService {
  constructor() {
    this.socket = null
    this.prices = {}
    this.subscribers = new Map()
    this.chargesListeners = new Set()
    this.isConnected = false
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
  }

  connect() {
    if (this.socket?.connected) return

    this.socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    })

    this.socket.on('connect', () => {
      console.log('[PriceStream] Connected to server')
      this.isConnected = true
      this.reconnectAttempts = 0
      // Subscribe to price stream
      this.socket.emit('subscribePrices')
      // Fire charges listeners so UI refetches fresh spreads/commissions after backend redeploy / reconnect.
      this.chargesListeners.forEach((cb) => {
        try { cb({ reason: 'reconnect' }) } catch (e) { console.error('[PriceStream] charges reconnect cb error:', e) }
      })
    })

    this.socket.on('priceStream', (data) => {
      const { prices, updated, timestamp } = data

      // Update local price cache. `prices` is the whole book and arrives on
      // subscribe and on the slow resync; `updated` is the per-frame delta and
      // carries only what moved, so it has to be merged too — it is the stream
      // that actually keeps quotes live between snapshots.
      if (prices) {
        this.prices = { ...this.prices, ...prices }
      }
      if (updated && Object.keys(updated).length > 0) {
        this.prices = { ...this.prices, ...updated }
      }

      // Notify all subscribers
      this.subscribers.forEach((callback, id) => {
        try {
          callback(this.prices, updated, timestamp)
        } catch (e) {
          console.error('[PriceStream] Subscriber error:', e)
        }
      })
    })

    // Admin pushes chargesUpdated when spread/commission/swap rules change, so user UI refetches immediately.
    this.socket.on('chargesUpdated', (payload) => {
      this.chargesListeners.forEach((cb) => {
        try { cb(payload) } catch (e) { console.error('[PriceStream] charges listener error:', e) }
      })
    })

    this.socket.on('disconnect', () => {
      console.log('[PriceStream] Disconnected')
      this.isConnected = false
    })

    this.socket.on('connect_error', (error) => {
      console.error('[PriceStream] Connection error:', error.message)
      this.reconnectAttempts++
    })
  }

  disconnect() {
    if (this.socket) {
      this.socket.emit('unsubscribePrices')
      this.socket.disconnect()
      this.socket = null
    }
    this.isConnected = false
    this.subscribers.clear()
  }

  subscribe(id, callback) {
    this.subscribers.set(id, callback)
    // Connect if not already connected
    if (!this.socket?.connected) {
      this.connect()
    }
    // Send current prices immediately
    if (Object.keys(this.prices).length > 0) {
      callback(this.prices, {}, Date.now())
    }
    return () => this.unsubscribe(id)
  }

  unsubscribe(id) {
    this.subscribers.delete(id)
    // Disconnect if no subscribers
    if (this.subscribers.size === 0 && this.chargesListeners.size === 0) {
      this.disconnect()
    }
  }

  onChargesUpdated(callback) {
    this.chargesListeners.add(callback)
    if (!this.socket?.connected) this.connect()
    return () => this.chargesListeners.delete(callback)
  }

  getPrice(symbol) {
    return this.prices[symbol] || null
  }

  getAllPrices() {
    return this.prices
  }

  // Calculate PnL for a trade using current prices
  calculatePnl(trade) {
    const prices = this.prices[trade.symbol]
    if (!prices) return 0
    
    const currentPrice = trade.side === 'BUY' ? prices.bid : prices.ask
    const contractSize = trade.contractSize || 100

    // pnlUsd converts out of the pair's quote currency — the bare price delta is
    // only dollars for USD-quoted symbols (USDJPY would read ~150x too high).
    return pnlUsd(
      trade.symbol, trade.side, trade.openPrice, currentPrice,
      trade.quantity, contractSize, (s) => this.prices[s] || null
    )
  }
}

// Singleton instance
const priceStreamService = new PriceStreamService()

export default priceStreamService
