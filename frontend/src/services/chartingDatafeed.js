// Custom datafeed for the TradingView Advanced Charting Library.
// Faithful port of SwisDex's lib/charting/datafeed.ts, wired to vxness:
//   - history : GET /api/charts/bars (Infoway klines via infowayService.getCandles)
//   - live    : /ws/bars (barSocket) — server-aggregated in-progress candle
//   - bid tick: priceStreamService (Socket.IO priceStream)
//
// Candles are aggregated server-side from the tick MID; here we shift them DOWN
// to the BID by half the live spread so the chart last-price matches the panel
// BID and a buy position's current price (MT4/MT5 convention).
import { API_URL } from '../config/api'
import priceStreamService from './priceStream'
import { barSocket } from './barSocket'

/* ─── Resolution maps ─── */

// Only SERVER_RESOLUTIONS exist on the backend; every other entry in
// SUPPORTED_RESOLUTIONS is aggregated CLIENT-SIDE by the charting library from a
// base (3←1, 10←5, 45←15, 120/180←60, W/M/...←1D), declared via
// intraday_multipliers + has_weekly_and_monthly:false below. The datafeed
// therefore only ever receives requests for a SERVER_RESOLUTION (or 1D).
const SERVER_RESOLUTIONS = ['1', '5', '15', '30', '60', '240']

const SUPPORTED_RESOLUTIONS = [
  '1', '3', '5', '10', '15', '30', '45', '60', '120', '180', '240',
  '1D', '1W', '1M', '3M', '6M', '12M',
]

/* ─── Instruments cache (digits / segment) ─── */

let _instruments = []
const _instrumentsBySymbol = new Map()
let _instrumentsPromise = null

function loadInstruments() {
  if (_instrumentsPromise) return _instrumentsPromise
  _instrumentsPromise = fetch(`${API_URL}/prices/instruments`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const list = Array.isArray(data?.instruments) ? data.instruments : []
      _instruments = list
      for (const i of list) _instrumentsBySymbol.set(String(i.symbol).toUpperCase(), i)
      return list
    })
    .catch(() => { _instruments = []; return [] })
  return _instrumentsPromise
}
// Warm the cache on module load so resolveSymbol has digits ready.
loadInstruments()

function instrumentOf(sym) {
  return _instrumentsBySymbol.get(String(sym).toUpperCase()) || null
}

function symbolDigits(sym) {
  const inst = instrumentOf(sym)
  const d = inst?.digits
  return Number.isFinite(d) ? d : 5
}

function segmentOf(sym) {
  return String(instrumentOf(sym)?.category || '').toLowerCase()
}

/* ─── Symbol category (weekend-bar filter) ─── */

const CRYPTO_BASES = new Set([
  'BTC', 'ETH', 'XRP', 'LTC', 'BCH', 'ADA', 'DOT', 'DOGE', 'SOL', 'BNB',
  'MATIC', 'AVAX', 'LINK', 'TRX', 'UNI', 'ATOM', 'XLM', 'ETC', 'FIL', 'APT',
  'NEAR', 'ARB', 'OP', 'SHIB', 'PEPE', 'SUI',
])

function getSymbolCategory(symbol) {
  const s = String(symbol).toUpperCase()
  const seg = segmentOf(s)
  if (seg) {
    if (seg.includes('crypto')) return 'crypto'
    if (seg.includes('metal')) return 'metals'
    if (seg.includes('commod')) return 'commodities'
    if (seg.includes('ind')) return 'indices'
    if (seg.includes('forex')) return 'forex'
  }
  if (s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD')) return 'metals'
  if (['USOIL', 'UKOIL', 'NGAS', 'NATGAS', 'COPPER'].includes(s)) return 'commodities'
  const base = s.replace(/USDT?$/, '')
  if ((s.endsWith('USD') || s.endsWith('USDT')) && CRYPTO_BASES.has(base)) return 'crypto'
  return 'forex'
}

function segmentToSymbolType(symbol) {
  switch (getSymbolCategory(symbol)) {
    case 'crypto': return 'crypto'
    case 'indices': return 'index'
    case 'commodities': return 'commodity'
    case 'metals': return 'commodity'
    default: return 'forex'
  }
}

// Drop Saturday/Sunday candles from a NON-crypto symbol's history — those
// markets are closed on weekends so weekend bars are just clutter. Weekday is
// read in UTC; bar.time is bar-open in ms UTC.
function dropWeekendBars(bars, symbol) {
  if (getSymbolCategory(symbol) === 'crypto') return bars
  return bars.filter((b) => {
    const day = new Date(b.time).getUTCDay()
    return day !== 0 && day !== 6
  })
}

/* ─── Live price / bid shift ─── */

// Wait up to timeoutMs for a live tick for `symbol` to appear in the price store.
function waitForPrice(symbol, timeoutMs = 2500) {
  const tick = priceStreamService.getPrice(symbol)
  if (tick && tick.bid > 0) return Promise.resolve(tick)
  return new Promise((resolve) => {
    let done = false
    const id = `chart-df-${symbol}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const finish = (v) => {
      if (done) return
      done = true
      try { priceStreamService.unsubscribe(id) } catch { /* ignore */ }
      resolve(v)
    }
    priceStreamService.subscribe(id, (prices) => {
      const t = prices?.[symbol]
      if (t && t.bid > 0) finish(t)
    })
    setTimeout(() => finish(null), timeoutMs)
  })
}

// Half the live spread — the amount to shift a MID bar down to the BID.
function halfSpreadOf(tick) {
  if (!tick || !(tick.bid > 0) || !(tick.ask > 0)) return 0
  return (tick.ask - tick.bid) / 2
}

function toBidBar(bar, halfSpread, digits) {
  if (halfSpread <= 0) return bar
  const shift = (v) => Number((v - halfSpread).toFixed(digits))
  return {
    ...bar,
    open: shift(bar.open),
    high: shift(bar.high),
    low: shift(bar.low),
    close: shift(bar.close),
  }
}

/* ─── Config ─── */

const CONFIG = {
  supported_resolutions: SUPPORTED_RESOLUTIONS,
  exchanges: [
    { value: '', name: 'All', desc: 'All exchanges' },
    { value: 'vxness', name: 'vxness', desc: 'vxness' },
  ],
  symbols_types: [
    { name: 'All', value: '' },
    { name: 'Forex', value: 'forex' },
    { name: 'Crypto', value: 'crypto' },
    { name: 'Index', value: 'index' },
    { name: 'Commodity', value: 'commodity' },
  ],
  supports_marks: false,
  supports_timescale_marks: false,
  supports_time: true,
}

/* ─── Subscriptions ─── */

const subscriptions = new Map()
let _reconnectHooked = false
function ensureReconnectHook() {
  if (_reconnectHooked) return
  _reconnectHooked = true
  barSocket.onReconnect(() => {
    for (const sub of subscriptions.values()) {
      try { sub.resetCache && sub.resetCache() } catch { /* ignore */ }
    }
  })
}

/* ═══════════ DATAFEED ═══════════ */

export const vxnessDatafeed = {
  onReady: (cb) => {
    setTimeout(() => cb(CONFIG), 0)
  },

  searchSymbols: (userInput, _exchange, symbolType, onResult) => {
    const q = String(userInput || '').trim().toUpperCase()
    const result = _instruments
      .filter((i) => {
        const sym = String(i.symbol).toUpperCase()
        if (symbolType && segmentToSymbolType(sym) !== symbolType) return false
        if (!q) return true
        return sym.includes(q) || String(i.name || '').toUpperCase().includes(q)
      })
      .slice(0, 50)
      .map((i) => ({
        symbol: i.symbol,
        full_name: i.symbol,
        description: i.name || i.symbol,
        exchange: 'vxness',
        ticker: i.symbol,
        type: segmentToSymbolType(i.symbol) || 'forex',
      }))
    onResult(result)
  },

  resolveSymbol: async (symbolName, onResolve) => {
    const sym = (String(symbolName).split(':').pop() || symbolName).toUpperCase()
    // Ensure the instruments cache (digits / segment) is loaded so pricescale is
    // correct on the very first symbol resolution, not just after getBars.
    await loadInstruments()
    const inst = instrumentOf(sym)
    const digits = symbolDigits(sym)
    const info = {
      ticker: sym,
      name: sym,
      description: inst?.name || sym,
      type: segmentToSymbolType(sym) || 'forex',
      session: '24x7',
      timezone: 'Etc/UTC',
      exchange: 'vxness',
      listed_exchange: 'vxness',
      format: 'price',
      pricescale: Math.pow(10, digits),
      minmov: 1,
      has_intraday: true,
      has_daily: true,
      // false on purpose: the library BUILDS 1W/1M/3M/6M/12M from our 1D bars.
      has_weekly_and_monthly: false,
      intraday_multipliers: SERVER_RESOLUTIONS,
      daily_multipliers: ['1'],
      supported_resolutions: SUPPORTED_RESOLUTIONS,
      volume_precision: 2,
      data_status: 'streaming',
    }
    setTimeout(() => onResolve(info), 0)
  },

  getBars: async (symbolInfo, resolution, periodParams, onResult, onError) => {
    try {
      const sym = String(symbolInfo.ticker || symbolInfo.name).toUpperCase()
      const { from, to } = periodParams
      await loadInstruments()

      const params = new URLSearchParams({
        symbol: sym,
        resolution: String(resolution),
        from: String(from),
        to: String(to),
      })
      const res = await fetch(`${API_URL}/charts/bars?${params}`)
      if (res.ok) {
        const data = await res.json()
        const rawBars = Array.isArray(data?.bars) ? data.bars : []
        if (rawBars.length > 0) {
          // Shift MID bars to BID so the chart matches the panel bid / P&L.
          const liveTick = await waitForPrice(sym, 2500)
          const hs = halfSpreadOf(liveTick)
          const digits = symbolDigits(sym)
          const bars = rawBars.map((b) => toBidBar({
            time: b.time * 1000, // seconds → ms
            open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
          }, hs, digits))
          onResult(dropWeekendBars(bars, sym), { noData: false })
          return
        }
      }
      // No data → say so honestly (the chart simply ends at the oldest real bar).
      onResult([], { noData: true })
    } catch (err) {
      onError((err && err.message) || 'getBars failed')
    }
  },

  subscribeBars: (symbolInfo, resolution, onTick, listenerGuid, onResetCacheNeededCallback) => {
    const sym = String(symbolInfo.ticker || symbolInfo.name).toUpperCase()
    const res = String(resolution)
    ensureReconnectHook()

    const unsub = barSocket.subscribe(sym, res, (bar) => {
      const sub = subscriptions.get(listenerGuid)
      if (!sub) return
      const hs = halfSpreadOf(priceStreamService.getPrice(sym))
      const digits = symbolDigits(sym)
      const b = toBidBar({
        time: bar.time * 1000, // seconds → ms
        open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
      }, hs, digits)
      sub.onTick(b)
    })

    subscriptions.set(listenerGuid, {
      symbol: sym,
      resolution: res,
      onTick,
      resetCache: onResetCacheNeededCallback,
      unsubscribe: () => { unsub() },
    })
  },

  unsubscribeBars: (listenerGuid) => {
    const sub = subscriptions.get(listenerGuid)
    if (sub) { sub.unsubscribe(); subscriptions.delete(listenerGuid) }
  },
}

export default vxnessDatafeed
