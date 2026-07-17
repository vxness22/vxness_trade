// Custom datafeed for the TradingView Advanced Charting Library.
// Faithful port of SwisDex's lib/charting/datafeed.ts, wired to vxness:
//   - history : GET /api/charts/bars (Infoway klines) — shifted to the DISPLAYED bid
//   - live    : built from priceStream, driven by the SAME displayed bid the order
//               panel + instrument list show, so the chart last price is exactly
//               equal to the SELL price (one source, no separate socket, no drift).
//
// The order panel / instrument list render adjustQuotesForTradingDisplay(bid,ask,…)
// (admin spread applied). We use that exact function via setQuoteAdjuster() so the
// candle == the panel to the last digit. Without an adjuster we fall back to the
// raw feed bid.
import { API_URL } from '../config/api'
import priceStreamService from './priceStream'

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

// The order panel + instrument list display prices through this adjuster (admin
// spread/markup). The chart component sets it so the candle uses the EXACT same
// value. adjuster(symbol, rawBid, rawAsk) → { bid, ask }.
let _quoteAdjuster = null
export function setQuoteAdjuster(fn) { _quoteAdjuster = typeof fn === 'function' ? fn : null }

// The DISPLAYED bid for a raw feed tick — exactly what the SELL button / list show.
function displayedBid(sym, tick) {
  if (!tick || !(tick.bid > 0)) return null
  if (_quoteAdjuster) {
    try { const q = _quoteAdjuster(sym, tick.bid, tick.ask); if (q && q.bid > 0) return q.bid } catch { /* fall back */ }
  }
  return tick.bid
}

// How far a raw MID bar must move DOWN to sit on the displayed bid (rawMid − dispBid).
// Equals half the spread when no adjuster is set — same as the old behaviour.
function displayShift(sym, tick) {
  if (!tick || !(tick.bid > 0) || !(tick.ask > 0)) return 0
  const rawMid = (tick.bid + tick.ask) / 2
  const db = displayedBid(sym, tick)
  return db != null ? rawMid - db : (tick.ask - tick.bid) / 2
}

function shiftBar(bar, shift, digits) {
  if (!shift) return bar
  const s = (v) => Number((v - shift).toFixed(digits))
  return { ...bar, open: s(bar.open), high: s(bar.high), low: s(bar.low), close: s(bar.close) }
}

// Resolution → seconds, for building the live forming bar on the timeframe grid.
const RES_SECONDS = {
  '1': 60, '3': 180, '5': 300, '10': 600, '15': 900, '30': 1800, '45': 2700,
  '60': 3600, '120': 7200, '180': 10800, '240': 14400, D: 86400, '1D': 86400,
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
          // Shift MID klines onto the DISPLAYED bid so history is continuous with
          // the live candle (and matches the panel bid).
          const liveTick = await waitForPrice(sym, 2500)
          const shift = displayShift(sym, liveTick)
          const digits = symbolDigits(sym)
          const bars = rawBars.map((b) => shiftBar({
            time: b.time * 1000, // seconds → ms
            open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
          }, shift, digits))
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

  subscribeBars: (symbolInfo, resolution, onTick, listenerGuid) => {
    const sym = String(symbolInfo.ticker || symbolInfo.name).toUpperCase()
    const res = String(resolution)
    const tfSec = RES_SECONDS[res] || 300
    let bar = null
    let lastSeenTickTime = 0 // last tick.time we processed — detects a genuinely new tick
    let lastTickAt = 0 // wall-clock ms when we last saw a new tick (market-live check)
    const id = `chart-bars-${listenerGuid}`

    // Build the forming candle straight from the price stream using the SAME
    // displayed bid the order panel / instrument list render. One source ⇒ the
    // chart last price equals the SELL price exactly, with no tick-to-tick flicker.
    priceStreamService.subscribe(id, (prices) => {
      const tick = prices?.[sym]
      const price = displayedBid(sym, tick)
      if (!(price > 0)) return
      const now = Date.now()
      const tickMs = (tick && tick.time) || now
      if (tickMs !== lastSeenTickTime) { lastSeenTickTime = tickMs; lastTickAt = now }

      // While the market is LIVE (a fresh tick within 90s), drive the candle
      // boundary off the WALL CLOCK so a new candle opens on time even during a
      // lull — otherwise the candle "sticks" until the next tick arrives. When
      // the market is quiet/closed, freeze on the last real tick time so we don't
      // paint fake flat candles (e.g. weekends).
      const marketLive = now - lastTickAt < 90000
      const boundaryMs = marketLive ? now : tickMs
      const barStart = Math.floor(Math.floor(boundaryMs / 1000) / tfSec) * tfSec

      if (!bar || barStart > bar.time) {
        // New period → open a fresh candle at the last price.
        bar = { time: barStart, open: price, high: price, low: price, close: price }
      } else if (barStart === bar.time) {
        if (price > bar.high) bar.high = price
        if (price < bar.low) bar.low = price
        bar.close = price
      } else {
        // Out-of-order / backward tick — ignore so the candle never jumps back.
        return
      }
      onTick({ time: bar.time * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 })
    })

    subscriptions.set(listenerGuid, {
      symbol: sym,
      resolution: res,
      unsubscribe: () => { try { priceStreamService.unsubscribe(id) } catch { /* ignore */ } },
    })
  },

  unsubscribeBars: (listenerGuid) => {
    const sub = subscriptions.get(listenerGuid)
    if (sub) { sub.unsubscribe(); subscriptions.delete(listenerGuid) }
  },
}

export default vxnessDatafeed
