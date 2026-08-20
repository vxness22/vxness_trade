// Custom datafeed for the TradingView Advanced Charting Library.
// Faithful port of SwisDex's lib/charting/datafeed.ts, wired to vxness:
//   - history : GET /api/charts/bars (Infoway klines)
//   - live    : the forming candle, built from priceStream on the same grid
//
// Both sides plot the feed MID, which is what makes the chart agree with
// TradingView candle for candle: Infoway's klines and TradingView's OANDA series
// are the same prices to three decimals, and the klines are mid (the latest
// kline close equals (bid+ask)/2 of the live tick exactly).
//
// This used to shift everything down onto the displayed BID so the chart's last
// price would equal the SELL button. That cost half a spread — about 0.30 on
// gold — against every TradingView chart a trader might compare it to, which is
// the more visible discrepancy of the two. The SELL price is still on screen in
// the order panel and the instrument list.
import { API_URL } from '../config/api'
import priceStreamService from './priceStream'
import {
  SESSION_START_HOUR_NY,
  barStartSeconds,
  dailyBarSeconds,
  isClosedSession,
} from '../utils/sessionGrid'

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

// Crypto runs 24x7 and has no session to anchor to; everything else follows the
// FX week, which opens 17:00 New York on Sunday and closes 17:00 on Friday.
function sessionAnchorHour(symbol) {
  return getSymbolCategory(symbol) === 'crypto' ? null : SESSION_START_HOUR_NY
}

// Drop bars from a session the instrument is shut for.
//
// The old rule dropped every bar whose UTC weekday was Saturday or Sunday, which
// also deleted the Sunday-evening open — 21:00 UTC onwards is Monday's session
// and is real trading that TradingView shows. Asking whether the bar's SESSION
// is a weekend one keeps that open and still drops the genuinely dead window
// between Friday's close and Sunday's.
function dropClosedSessionBars(bars, symbol) {
  const anchor = sessionAnchorHour(symbol)
  if (anchor == null) return bars
  return bars.filter((b) => !isClosedSession(Math.floor(b.time / 1000), anchor))
}

/* ─── Live price ─── */

// The MID of a raw feed tick — the price the klines are quoted at, so the live
// candle continues history without a step at the join.
function tickMid(tick) {
  if (!tick || !(tick.bid > 0) || !(tick.ask > 0)) return null
  return (tick.bid + tick.ask) / 2
}

// Resolution → seconds, for building the live forming bar on the timeframe grid.
// Daily and above are handled separately, by trading date rather than by period.
const RES_SECONDS = {
  '1': 60, '3': 180, '5': 300, '10': 600, '15': 900, '30': 1800, '45': 2700,
  '60': 3600, '120': 7200, '180': 10800, '240': 14400,
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
      // The session is what the library anchors CLIENT-SIDE aggregation on, and
      // it has to be the same 17:00-New-York day the backend buckets by —
      // otherwise 3m/10m/45m/2h/3h (built here from our 1m/5m/15m/1h bars) and
      // 1W/1M (built from our 1D bars) would land on a different grid than the
      // history underneath them. '1700-1700:23456' is Sunday-evening through
      // Friday-evening, which is also the grid TradingView's own charts use.
      session: sessionAnchorHour(sym) == null ? '24x7' : '1700-1700:23456',
      timezone: sessionAnchorHour(sym) == null ? 'Etc/UTC' : 'America/New_York',
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
          // Klines are already the feed mid, which is what the live candle uses
          // too — nothing to reconcile, the two series are the same prices.
          const bars = rawBars.map((b) => ({
            time: b.time * 1000, // seconds → ms
            open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
          }))
          onResult(dropClosedSessionBars(bars, sym), { noData: false })
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
    const anchor = sessionAnchorHour(sym)
    const tfSec = RES_SECONDS[res] || null // null ⇒ daily or slower
    let bar = null
    let lastSeenTickTime = 0 // last tick.time we processed — detects a genuinely new tick
    let lastTickAt = 0 // wall-clock ms when we last saw a new tick (market-live check)
    const id = `chart-bars-${listenerGuid}`

    // Which bar a moment belongs to. Intraday snaps onto the session-anchored
    // grid; daily and slower go by trading date, stamped at midnight UTC — the
    // same two rules the backend uses to cut history, so the forming candle
    // lands on the bar the history left open instead of next to it.
    const barStartFor = (sec) => (tfSec ? barStartSeconds(sec, tfSec, anchor) : dailyBarSeconds(sec, anchor))

    // Build the forming candle straight from the price stream, on the feed MID —
    // the same quote the klines behind it are made of.
    priceStreamService.subscribe(id, (prices) => {
      const tick = prices?.[sym]
      const price = tickMid(tick)
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
      const barStart = barStartFor(Math.floor(boundaryMs / 1000))

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
