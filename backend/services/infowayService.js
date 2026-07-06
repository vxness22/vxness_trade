import WebSocket from 'ws'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const INFOWAY_API_KEY = process.env.INFOWAY_API_KEY

// Last-known prices are persisted here so that, if the Infoway feed is down or the
// API key has expired at startup, the service can serve the last traded prices
// (frozen) instead of falling back to generic static defaults.
const PRICE_CACHE_DIR = path.join(__dirname, '..', 'data')
const PRICE_CACHE_FILE = path.join(PRICE_CACHE_DIR, 'lastPrices.json')
const PRICE_PERSIST_INTERVAL_MS = 30_000

// WebSocket URLs — same pattern that was working pre-MetaApi switch
const WS_FOREX_URL = `wss://data.infoway.io/ws?business=common&apikey=${INFOWAY_API_KEY}`
const WS_CRYPTO_URL = `wss://data.infoway.io/ws?business=crypto&apikey=${INFOWAY_API_KEY}`

// REST base for historical OHLC. Override via env if Infoway docs say otherwise.
const INFOWAY_REST_BASE = process.env.INFOWAY_REST_BASE || 'https://data.infoway.io'

// ========== FOREX MAJORS (7) ==========
const FOREX_MAJORS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD'
]

// ========== FOREX CROSSES (21) ==========
const FOREX_CROSSES = [
  'EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF', 'EURAUD', 'EURCAD', 'GBPAUD',
  'GBPCAD', 'AUDCAD', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY', 'AUDNZD',
  'CADCHF', 'GBPCHF', 'GBPNZD', 'EURNZD', 'NZDCAD', 'NZDCHF', 'AUDCHF'
]

// ========== FOREX EXOTICS (36) ==========
const FOREX_EXOTICS = [
  'USDSGD', 'EURSGD', 'GBPSGD', 'AUDSGD', 'SGDJPY', 'USDHKD',
  'USDZAR', 'EURZAR', 'GBPZAR', 'ZARJPY',
  'USDTRY', 'EURTRY', 'TRYJPY',
  'USDMXN', 'EURMXN', 'MXNJPY',
  'USDPLN', 'EURPLN', 'GBPPLN',
  'USDSEK', 'EURSEK', 'GBPSEK', 'SEKJPY',
  'USDNOK', 'EURNOK', 'GBPNOK', 'NOKJPY',
  'USDDKK', 'EURDKK', 'DKKJPY',
  'USDCNH', 'CNHJPY',
  'USDHUF', 'EURHUF', 'USDCZK', 'EURCZK'
]

const FOREX_SYMBOLS = [...FOREX_MAJORS, ...FOREX_CROSSES, ...FOREX_EXOTICS]

// ========== METALS (4) ==========
const METALS_SYMBOLS = ['XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD']

// ========== COMMODITIES (4) ==========
const COMMODITIES_SYMBOLS = ['USOIL', 'UKOIL', 'NGAS', 'COPPER']

// ========== CRYPTO (44) ==========
const CRYPTO_SYMBOLS = [
  'BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BCHUSD', 'BNBUSD', 'ADAUSD', 'DOTUSD',
  'SOLUSD', 'DOGEUSD', 'MATICUSD', 'AVAXUSD', 'LINKUSD', 'UNIUSD', 'ATOMUSD',
  'XLMUSD', 'ALGOUSD', 'VETUSD', 'ICPUSD', 'FILUSD', 'TRXUSD', 'ETCUSD',
  'XMRUSD', 'EOSUSD', 'AAVEUSD', 'MKRUSD', 'COMPUSD', 'SNXUSD', 'YFIUSD',
  'SUSHIUSD', 'NEARUSD', 'FTMUSD', 'SANDUSD', 'MANAUSD', 'AXSUSD', 'GALAUSD',
  'APEUSD', 'GMTUSD', 'OPUSD', 'ARBUSD', 'PEPEUSD', 'SHIBUSD', 'TONUSD', 'HBARUSD'
]

// Infoway symbol format mapping (crypto uses USDT suffix on Infoway feed)
const toInfowaySymbol = (symbol) => {
  if (CRYPTO_SYMBOLS.includes(symbol)) {
    return symbol.replace('USD', 'USDT')
  }
  return symbol
}

const fromInfowaySymbol = (infowaySymbol) => {
  if (infowaySymbol.endsWith('USDT')) {
    return infowaySymbol.replace('USDT', 'USD')
  }
  return infowaySymbol
}

const SUPPORTED_SYMBOLS = [...FOREX_SYMBOLS, ...METALS_SYMBOLS, ...COMMODITIES_SYMBOLS, ...CRYPTO_SYMBOLS]

// Fallback static prices for all 116 supported symbols.
// USED ONLY when Infoway WebSocket isn't streaming a symbol.
const FALLBACK_PRICES = {
  'EURUSD': { bid: 1.1320, ask: 1.1322 },
  'GBPUSD': { bid: 1.3450, ask: 1.3452 },
  'USDJPY': { bid: 145.50, ask: 145.52 },
  'USDCHF': { bid: 0.8050, ask: 0.8052 },
  'AUDUSD': { bid: 0.6450, ask: 0.6452 },
  'NZDUSD': { bid: 0.5980, ask: 0.5982 },
  'USDCAD': { bid: 1.3950, ask: 1.3952 },

  'EURGBP': { bid: 0.8420, ask: 0.8422 },
  'EURJPY': { bid: 164.80, ask: 164.82 },
  'GBPJPY': { bid: 195.80, ask: 195.82 },
  'EURCHF': { bid: 0.9120, ask: 0.9122 },
  'EURAUD': { bid: 1.7550, ask: 1.7552 },
  'EURCAD': { bid: 1.5790, ask: 1.5792 },
  'GBPAUD': { bid: 2.0850, ask: 2.0852 },
  'GBPCAD': { bid: 1.8770, ask: 1.8772 },
  'AUDCAD': { bid: 0.9000, ask: 0.9002 },
  'AUDJPY': { bid: 93.85, ask: 93.87 },
  'CADJPY': { bid: 104.30, ask: 104.32 },
  'CHFJPY': { bid: 180.70, ask: 180.72 },
  'NZDJPY': { bid: 87.05, ask: 87.07 },
  'AUDNZD': { bid: 1.0785, ask: 1.0787 },
  'CADCHF': { bid: 0.5770, ask: 0.5772 },
  'GBPCHF': { bid: 1.0825, ask: 1.0827 },
  'GBPNZD': { bid: 2.2490, ask: 2.2492 },
  'EURNZD': { bid: 1.8930, ask: 1.8932 },
  'NZDCAD': { bid: 0.8340, ask: 0.8342 },
  'NZDCHF': { bid: 0.4820, ask: 0.4822 },
  'AUDCHF': { bid: 0.5195, ask: 0.5197 },

  'USDSGD': { bid: 1.2920, ask: 1.2922 },
  'EURSGD': { bid: 1.4625, ask: 1.4627 },
  'GBPSGD': { bid: 1.7378, ask: 1.7380 },
  'AUDSGD': { bid: 0.8333, ask: 0.8335 },
  'SGDJPY': { bid: 112.60, ask: 112.62 },
  'USDHKD': { bid: 7.7820, ask: 7.7822 },
  'USDZAR': { bid: 18.20, ask: 18.22 },
  'EURZAR': { bid: 20.60, ask: 20.62 },
  'GBPZAR': { bid: 24.48, ask: 24.50 },
  'ZARJPY': { bid: 8.00, ask: 8.01 },
  'USDTRY': { bid: 38.50, ask: 38.55 },
  'EURTRY': { bid: 43.58, ask: 43.62 },
  'TRYJPY': { bid: 3.78, ask: 3.79 },
  'USDMXN': { bid: 19.40, ask: 19.42 },
  'EURMXN': { bid: 21.96, ask: 21.98 },
  'MXNJPY': { bid: 7.50, ask: 7.51 },
  'USDPLN': { bid: 3.75, ask: 3.752 },
  'EURPLN': { bid: 4.24, ask: 4.242 },
  'GBPPLN': { bid: 5.04, ask: 5.042 },
  'USDSEK': { bid: 9.55, ask: 9.552 },
  'EURSEK': { bid: 10.81, ask: 10.812 },
  'GBPSEK': { bid: 12.85, ask: 12.852 },
  'SEKJPY': { bid: 15.23, ask: 15.24 },
  'USDNOK': { bid: 10.20, ask: 10.202 },
  'EURNOK': { bid: 11.55, ask: 11.552 },
  'GBPNOK': { bid: 13.72, ask: 13.722 },
  'NOKJPY': { bid: 14.26, ask: 14.27 },
  'USDDKK': { bid: 6.58, ask: 6.582 },
  'EURDKK': { bid: 7.45, ask: 7.452 },
  'DKKJPY': { bid: 22.10, ask: 22.11 },
  'USDCNH': { bid: 7.20, ask: 7.202 },
  'CNHJPY': { bid: 20.20, ask: 20.21 },
  'USDHUF': { bid: 348.50, ask: 348.70 },
  'EURHUF': { bid: 394.30, ask: 394.50 },
  'USDCZK': { bid: 21.90, ask: 21.92 },
  'EURCZK': { bid: 24.79, ask: 24.81 },

  'XAUUSD': { bid: 4155.40, ask: 4155.90 },
  'XAGUSD': { bid: 32.85, ask: 32.87 },
  'XPTUSD': { bid: 1075.00, ask: 1076.00 },
  'XPDUSD': { bid: 980.00, ask: 981.00 },

  'USOIL': { bid: 62.30, ask: 62.35 },
  'UKOIL': { bid: 65.80, ask: 65.85 },
  'NGAS': { bid: 3.45, ask: 3.46 },
  'COPPER': { bid: 4.65, ask: 4.66 },

  'BTCUSD': { bid: 103500.00, ask: 103550.00 },
  'ETHUSD': { bid: 2480.00, ask: 2482.00 },
  'LTCUSD': { bid: 96.00, ask: 96.20 },
  'XRPUSD': { bid: 2.42, ask: 2.43 },
  'BCHUSD': { bid: 412.00, ask: 412.50 },
  'BNBUSD': { bid: 645.00, ask: 645.50 },
  'ADAUSD': { bid: 0.78, ask: 0.782 },
  'DOTUSD': { bid: 4.50, ask: 4.52 },
  'SOLUSD': { bid: 168.00, ask: 168.20 },
  'DOGEUSD': { bid: 0.22, ask: 0.221 },
  'MATICUSD': { bid: 0.24, ask: 0.242 },
  'AVAXUSD': { bid: 23.50, ask: 23.55 },
  'LINKUSD': { bid: 16.50, ask: 16.52 },
  'UNIUSD': { bid: 7.80, ask: 7.82 },
  'ATOMUSD': { bid: 4.60, ask: 4.62 },
  'XLMUSD': { bid: 0.30, ask: 0.301 },
  'ALGOUSD': { bid: 0.22, ask: 0.221 },
  'VETUSD': { bid: 0.030, ask: 0.0301 },
  'ICPUSD': { bid: 5.80, ask: 5.82 },
  'FILUSD': { bid: 3.20, ask: 3.22 },
  'TRXUSD': { bid: 0.26, ask: 0.261 },
  'ETCUSD': { bid: 17.20, ask: 17.25 },
  'XMRUSD': { bid: 325.00, ask: 325.50 },
  'EOSUSD': { bid: 0.58, ask: 0.582 },
  'AAVEUSD': { bid: 240.00, ask: 240.50 },
  'MKRUSD': { bid: 1620.00, ask: 1622.00 },
  'COMPUSD': { bid: 45.00, ask: 45.20 },
  'SNXUSD': { bid: 1.20, ask: 1.22 },
  'YFIUSD': { bid: 5800.00, ask: 5810.00 },
  'SUSHIUSD': { bid: 0.78, ask: 0.79 },
  'NEARUSD': { bid: 2.85, ask: 2.87 },
  'FTMUSD': { bid: 0.78, ask: 0.782 },
  'SANDUSD': { bid: 0.32, ask: 0.322 },
  'MANAUSD': { bid: 0.32, ask: 0.322 },
  'AXSUSD': { bid: 3.20, ask: 3.22 },
  'GALAUSD': { bid: 0.022, ask: 0.0222 },
  'APEUSD': { bid: 0.78, ask: 0.79 },
  'GMTUSD': { bid: 0.085, ask: 0.086 },
  'OPUSD': { bid: 0.85, ask: 0.86 },
  'ARBUSD': { bid: 0.38, ask: 0.382 },
  'PEPEUSD': { bid: 0.0000115, ask: 0.0000116 },
  'SHIBUSD': { bid: 0.0000142, ask: 0.0000143 },
  'TONUSD': { bid: 3.20, ask: 3.22 },
  'HBARUSD': { bid: 0.19, ask: 0.191 }
}

const STALE_MS = 60_000
const WATCHDOG_INTERVAL_MS = 15_000
const HEARTBEAT_INTERVAL_MS = 30_000
const CONNECT_TIMEOUT_MS = 15_000
const RECONNECT_BASE_DELAY_MS = 2_000
const RECONNECT_MAX_DELAY_MS = 30_000

// Timeframe map: routes/charts.js sends MetaApi-style strings ('1m', '5m', ..., '1mn').
// Infoway kline endpoint typically expects '1','5','15','30','60','240','1D','1W','1M'.
// Adjust here if Infoway docs say otherwise.
const TF_TO_INFOWAY = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '4h': '240',
  '1d': '1D', '1w': '1W', '1mn': '1M',
}

class InfowayService {
  constructor() {
    this.forexWs = null
    this.cryptoWs = null
    this.prices = new Map()
    this.subscribers = new Set()
    this.heartbeatInterval = null
    this.watchdogInterval = null
    this.forexLastMessageAt = 0
    this.cryptoLastMessageAt = 0
    this.forexReconnectAttempts = 0
    this.cryptoReconnectAttempts = 0
    this.forexReconnectTimer = null
    this.cryptoReconnectTimer = null
    this.persistInterval = null
    this.lastTickAt = 0
    this.shutdown = false

    // Seed the cache with the last persisted prices so quotes are available
    // immediately on startup — even before the first live tick, and even if the
    // API key has expired (prices stay frozen at their last traded value).
    this.loadPersistedPrices()
  }

  async connect() {
    if (!INFOWAY_API_KEY) {
      console.error('[Infoway] No INFOWAY_API_KEY configured — serving last persisted (frozen) prices')
      return false
    }
    this.shutdown = false
    console.log('[Infoway] Starting service...')
    await Promise.allSettled([this.connectForex(), this.connectCrypto()])
    this.startHeartbeat()
    this.startWatchdog()
    this.startPersistence()
    console.log('[Infoway] Service started (self-healing enabled)')
    return true
  }

  // ---- Last-price persistence (keeps prices frozen across restarts) ----
  loadPersistedPrices() {
    try {
      if (!fs.existsSync(PRICE_CACHE_FILE)) return
      const raw = fs.readFileSync(PRICE_CACHE_FILE, 'utf8')
      const saved = JSON.parse(raw)
      if (saved && typeof saved === 'object' && saved.prices) {
        Object.entries(saved.prices).forEach(([symbol, price]) => {
          if (price && typeof price.bid === 'number' && typeof price.ask === 'number') {
            this.prices.set(symbol, price)
          }
        })
        console.log(`[Infoway] Loaded ${this.prices.size} persisted (frozen) prices from disk`)
      }
    } catch (e) {
      console.error('[Infoway] Failed to load persisted prices:', e.message)
    }
  }

  persistPrices() {
    try {
      if (this.prices.size === 0) return
      if (!fs.existsSync(PRICE_CACHE_DIR)) fs.mkdirSync(PRICE_CACHE_DIR, { recursive: true })
      const payload = {
        savedAt: Date.now(),
        prices: Object.fromEntries(this.prices),
      }
      fs.writeFileSync(PRICE_CACHE_FILE, JSON.stringify(payload), 'utf8')
    } catch (e) {
      console.error('[Infoway] Failed to persist prices:', e.message)
    }
  }

  startPersistence() {
    if (this.persistInterval) clearInterval(this.persistInterval)
    this.persistInterval = setInterval(() => this.persistPrices(), PRICE_PERSIST_INTERVAL_MS)
  }

  connectForex() {
    return new Promise((resolve) => {
      if (this.shutdown) return resolve()
      let settled = false
      const done = () => { if (!settled) { settled = true; resolve() } }

      let ws
      try {
        ws = new WebSocket(WS_FOREX_URL)
      } catch (e) {
        console.error('[Infoway] Forex WS construct error:', e.message)
        this.scheduleForexReconnect()
        return done()
      }
      this.forexWs = ws

      ws.on('open', () => {
        this.forexReconnectAttempts = 0
        this.forexLastMessageAt = Date.now()
        console.log('[Infoway] Forex WebSocket connected')
        try {
          const allForexSymbols = [...FOREX_SYMBOLS, ...METALS_SYMBOLS, ...COMMODITIES_SYMBOLS]
          this.subscribeToDepth(ws, allForexSymbols)
        } catch (e) {
          console.error('[Infoway] Forex subscribe error:', e.message)
        }
        done()
      })

      ws.on('message', (data) => {
        this.forexLastMessageAt = Date.now()
        this.handleMessage(data)
      })

      ws.on('error', (err) => {
        console.error('[Infoway] Forex WS error:', err.message)
      })

      ws.on('close', (code, reason) => {
        console.warn(`[Infoway] Forex WS closed (code=${code}, reason=${reason?.toString() || 'n/a'})`)
        if (this.forexWs === ws) this.forexWs = null
        done()
        this.scheduleForexReconnect()
      })

      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CLOSED) {
          console.error('[Infoway] Forex connect timeout, terminating socket')
          try { ws.terminate() } catch (e) {}
        }
        done()
      }, CONNECT_TIMEOUT_MS)
    })
  }

  connectCrypto() {
    return new Promise((resolve) => {
      if (this.shutdown) return resolve()
      let settled = false
      const done = () => { if (!settled) { settled = true; resolve() } }

      let ws
      try {
        ws = new WebSocket(WS_CRYPTO_URL)
      } catch (e) {
        console.error('[Infoway] Crypto WS construct error:', e.message)
        this.scheduleCryptoReconnect()
        return done()
      }
      this.cryptoWs = ws

      ws.on('open', () => {
        this.cryptoReconnectAttempts = 0
        this.cryptoLastMessageAt = Date.now()
        console.log('[Infoway] Crypto WebSocket connected')
        try {
          this.subscribeToDepth(ws, CRYPTO_SYMBOLS.map(toInfowaySymbol))
        } catch (e) {
          console.error('[Infoway] Crypto subscribe error:', e.message)
        }
        done()
      })

      ws.on('message', (data) => {
        this.cryptoLastMessageAt = Date.now()
        this.handleMessage(data)
      })

      ws.on('error', (err) => {
        console.error('[Infoway] Crypto WS error:', err.message)
      })

      ws.on('close', (code, reason) => {
        console.warn(`[Infoway] Crypto WS closed (code=${code}, reason=${reason?.toString() || 'n/a'})`)
        if (this.cryptoWs === ws) this.cryptoWs = null
        done()
        this.scheduleCryptoReconnect()
      })

      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CLOSED) {
          console.error('[Infoway] Crypto connect timeout, terminating socket')
          try { ws.terminate() } catch (e) {}
        }
        done()
      }, CONNECT_TIMEOUT_MS)
    })
  }

  scheduleForexReconnect() {
    if (this.shutdown || this.forexReconnectTimer) return
    this.forexReconnectAttempts++
    const expStep = Math.min(this.forexReconnectAttempts - 1, 4)
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * Math.pow(2, expStep))
    console.log(`[Infoway] Forex reconnect attempt #${this.forexReconnectAttempts} in ${delay}ms`)
    this.forexReconnectTimer = setTimeout(() => {
      this.forexReconnectTimer = null
      if (this.shutdown) return
      this.connectForex().catch((e) => console.error('[Infoway] Forex reconnect error:', e?.message))
    }, delay)
  }

  scheduleCryptoReconnect() {
    if (this.shutdown || this.cryptoReconnectTimer) return
    this.cryptoReconnectAttempts++
    const expStep = Math.min(this.cryptoReconnectAttempts - 1, 4)
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * Math.pow(2, expStep))
    console.log(`[Infoway] Crypto reconnect attempt #${this.cryptoReconnectAttempts} in ${delay}ms`)
    this.cryptoReconnectTimer = setTimeout(() => {
      this.cryptoReconnectTimer = null
      if (this.shutdown) return
      this.connectCrypto().catch((e) => console.error('[Infoway] Crypto reconnect error:', e?.message))
    }, delay)
  }

  subscribeToDepth(ws, symbols) {
    const msg = {
      code: 10003,
      trace: Date.now().toString(),
      data: { codes: symbols.join(',') }
    }
    ws.send(JSON.stringify(msg))
    console.log(`[Infoway] Subscribed to ${symbols.length} symbols`)
  }

  handleMessage(data) {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.code === 10005 && msg.data) {
        const infowaySymbol = msg.data.s
        const symbol = fromInfowaySymbol(infowaySymbol)
        const askPrice = msg.data.a?.[0]?.[0]
        const bidPrice = msg.data.b?.[0]?.[0]

        if (bidPrice && askPrice) {
          const priceData = {
            bid: parseFloat(bidPrice),
            ask: parseFloat(askPrice),
            time: msg.data.t || Date.now()
          }
          this.lastTickAt = Date.now()
          this.prices.set(symbol, priceData)
          this.subscribers.forEach(callback => {
            try { callback(symbol, priceData) } catch (e) {}
          })
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    this.heartbeatInterval = setInterval(() => {
      const ping = { code: 10010, trace: Date.now().toString() }
      try {
        if (this.forexWs?.readyState === WebSocket.OPEN) {
          this.forexWs.send(JSON.stringify(ping))
        }
      } catch (e) {
        console.error('[Infoway] Forex heartbeat send error:', e.message)
      }
      try {
        if (this.cryptoWs?.readyState === WebSocket.OPEN) {
          this.cryptoWs.send(JSON.stringify(ping))
        }
      } catch (e) {
        console.error('[Infoway] Crypto heartbeat send error:', e.message)
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  startWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval)
    this.watchdogInterval = setInterval(() => {
      if (this.shutdown) return
      const now = Date.now()

      if (this.forexWs?.readyState === WebSocket.OPEN) {
        if (this.forexLastMessageAt && (now - this.forexLastMessageAt) > STALE_MS) {
          const ageSec = Math.round((now - this.forexLastMessageAt) / 1000)
          console.warn(`[Infoway] Forex WS stale (${ageSec}s no data), terminating to force reconnect`)
          try { this.forexWs.terminate() } catch (e) {}
        }
      } else if (!this.forexWs && !this.forexReconnectTimer) {
        console.log('[Infoway] Watchdog: forex WS missing, scheduling reconnect')
        this.scheduleForexReconnect()
      }

      if (this.cryptoWs?.readyState === WebSocket.OPEN) {
        if (this.cryptoLastMessageAt && (now - this.cryptoLastMessageAt) > STALE_MS) {
          const ageSec = Math.round((now - this.cryptoLastMessageAt) / 1000)
          console.warn(`[Infoway] Crypto WS stale (${ageSec}s no data), terminating to force reconnect`)
          try { this.cryptoWs.terminate() } catch (e) {}
        }
      } else if (!this.cryptoWs && !this.cryptoReconnectTimer) {
        console.log('[Infoway] Watchdog: crypto WS missing, scheduling reconnect')
        this.scheduleCryptoReconnect()
      }
    }, WATCHDOG_INTERVAL_MS)
  }

  isHealthy() {
    const now = Date.now()
    const forexOk = this.forexWs?.readyState === WebSocket.OPEN &&
      this.forexLastMessageAt && (now - this.forexLastMessageAt) < STALE_MS
    const cryptoOk = this.cryptoWs?.readyState === WebSocket.OPEN &&
      this.cryptoLastMessageAt && (now - this.cryptoLastMessageAt) < STALE_MS
    return { forex: !!forexOk, crypto: !!cryptoOk }
  }

  // Feed status for the frontend. `live` = receiving fresh ticks. When the API key
  // expires / feed drops, `live` becomes false and the cached prices are "frozen".
  getFeedStatus() {
    const now = Date.now()
    const health = this.isHealthy()
    const live = health.forex || health.crypto
    return {
      live,
      frozen: !live && this.prices.size > 0,
      apiKeyConfigured: !!INFOWAY_API_KEY,
      lastTickAt: this.lastTickAt || null,
      ageMs: this.lastTickAt ? now - this.lastTickAt : null,
      forex: health.forex,
      crypto: health.crypto,
      symbols: this.prices.size,
    }
  }

  getPrice(symbol) {
    return this.prices.get(symbol) || FALLBACK_PRICES[symbol] || null
  }

  getAllPrices() {
    const prices = {}
    this.prices.forEach((price, symbol) => { prices[symbol] = price })
    return prices
  }

  subscribe(callback) {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  async fetchBatchPrices(symbols) {
    const prices = {}
    symbols.forEach(symbol => {
      const price = this.getPrice(symbol)
      if (price) prices[symbol] = price
    })
    return prices
  }

  getSymbols() { return SUPPORTED_SYMBOLS }
  isCrypto(symbol) { return CRYPTO_SYMBOLS.includes(symbol) }

  // Historical OHLC for TradingView chart `/api/charts/history`.
  // Signature mirrors the previous MetaApi method so routes/charts.js doesn't change shape:
  //   getCandles(symbol, timeframe, startTime, limit)
  //   - symbol: 'EURUSD', 'BTCUSD', ...
  //   - timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1mn'
  //   - startTime: Date — walks BACKWARD from here
  //   - limit: number of bars to return (max ~1000)
  // Returns [{ time: Date, open, high, low, close, tickVolume }] sorted ascending.
  //
  // IMPORTANT: The exact Infoway REST URL + response schema is provider-specific. The
  // implementation below assumes the common `/api/v1/kline` shape — if Infoway uses a
  // different path or field names, set INFOWAY_REST_BASE or tweak the parsing block.
  async getCandles(symbol, timeframe, startTime, limit = 500) {
    if (!INFOWAY_API_KEY) return []
    const interval = TF_TO_INFOWAY[timeframe] || timeframe
    const business = CRYPTO_SYMBOLS.includes(symbol) ? 'crypto' : 'common'
    const infSymbol = toInfowaySymbol(symbol)
    const endMs = startTime instanceof Date ? startTime.getTime() : Number(startTime) || Date.now()

    const url = new URL(`${INFOWAY_REST_BASE}/api/v1/kline`)
    url.searchParams.set('apikey', INFOWAY_API_KEY)
    url.searchParams.set('business', business)
    url.searchParams.set('symbol', infSymbol)
    url.searchParams.set('interval', interval)
    url.searchParams.set('end', String(endMs))
    url.searchParams.set('limit', String(Math.min(1000, Math.max(1, limit))))

    try {
      const res = await fetch(url.toString())
      if (!res.ok) {
        console.error(`[Infoway] /kline ${symbol} ${interval} → HTTP ${res.status}`)
        return []
      }
      const body = await res.json()

      // Accept a few common shapes:
      //   { data: [[t,o,h,l,c,v], ...] }              ← binance-style
      //   { data: [{t,o,h,l,c,v}, ...] }              ← object-style
      //   { data: { list: [...] } }
      //   [ ... ] at root
      let rows = []
      if (Array.isArray(body)) rows = body
      else if (Array.isArray(body?.data)) rows = body.data
      else if (Array.isArray(body?.data?.list)) rows = body.data.list
      else if (Array.isArray(body?.data?.klines)) rows = body.data.klines

      const candles = rows.map((row) => {
        if (Array.isArray(row)) {
          // [t, o, h, l, c, v]
          const [t, o, h, l, c, v] = row
          return {
            time: new Date(Number(t)),
            open: parseFloat(o),
            high: parseFloat(h),
            low: parseFloat(l),
            close: parseFloat(c),
            tickVolume: v != null ? parseFloat(v) : 0,
          }
        }
        // object form — try a few field-name variants
        const t = row.t ?? row.time ?? row.timestamp ?? row.ts
        return {
          time: new Date(Number(t)),
          open: parseFloat(row.o ?? row.open),
          high: parseFloat(row.h ?? row.high),
          low: parseFloat(row.l ?? row.low),
          close: parseFloat(row.c ?? row.close),
          tickVolume: parseFloat(row.v ?? row.volume ?? row.vol ?? 0),
        }
      }).filter((c) => Number.isFinite(c.open) && c.time instanceof Date && !isNaN(c.time))

      candles.sort((a, b) => a.time - b.time)
      return candles
    } catch (err) {
      console.error(`[Infoway] /kline ${symbol} ${interval} error:`, err.message)
      return []
    }
  }

  async disconnect() {
    this.shutdown = true
    this.persistPrices() // flush last-known prices so they stay frozen across the restart
    if (this.persistInterval) { clearInterval(this.persistInterval); this.persistInterval = null }
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null }
    if (this.watchdogInterval) { clearInterval(this.watchdogInterval); this.watchdogInterval = null }
    if (this.forexReconnectTimer) { clearTimeout(this.forexReconnectTimer); this.forexReconnectTimer = null }
    if (this.cryptoReconnectTimer) { clearTimeout(this.cryptoReconnectTimer); this.cryptoReconnectTimer = null }
    try { this.forexWs?.close() } catch (e) {}
    try { this.cryptoWs?.close() } catch (e) {}
  }
}

const infowayService = new InfowayService()
export default infowayService
export { SUPPORTED_SYMBOLS, CRYPTO_SYMBOLS, FALLBACK_PRICES }
