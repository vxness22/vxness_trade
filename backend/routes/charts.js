import express from 'express'
import infowayService, { SUPPORTED_SYMBOLS } from '../services/infowayService.js'
import { resolveTradeSegment } from '../utils/tradeSegment.js'
import { pipSize } from '../utils/symbolMeta.js'

const router = express.Router()

// TradingView UDF (Universal Data Feed) protocol endpoints for the Charting Library.
// Spec: https://www.tradingview.com/charting-library-docs/latest/connecting_data/UDF/
//
// The Charting Library calls these endpoints via the frontend datafeed adapter.
// Bars come from Infoway historical klines, real-time ticks ride the existing Socket.IO stream.

// Map TradingView resolution → Infoway timeframe string (mirrors keys in infowayService.TF_TO_INFOWAY)
const RES_TO_TIMEFRAME = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', '240': '4h',
  'D': '1d', '1D': '1d',
  'W': '1w', '1W': '1w',
  'M': '1mn', '1M': '1mn',
}

// How many seconds each resolution represents (used to step backward when paginating)
const RES_TO_SECONDS = {
  '1': 60, '5': 300, '15': 900, '30': 1800,
  '60': 3600, '240': 14400,
  'D': 86400, '1D': 86400,
  'W': 604800, '1W': 604800,
  'M': 2592000, '1M': 2592000,
}

// Decimals to expose for each symbol — controls Charting Library price precision.
function priceScale(symbol) {
  const ps = pipSize(symbol)
  if (ps <= 0) return 100000
  return Math.round(1 / ps)
}

// 1. Datafeed configuration — read on chart init
router.get('/config', (req, res) => {
  res.json({
    supports_search: true,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [{ value: '', name: 'All', desc: '' }, { value: 'vxness', name: 'vxness', desc: 'vxness Brokerage' }],
    symbols_types: [
      { name: 'All', value: '' },
      { name: 'Forex', value: 'forex' },
      { name: 'Metals', value: 'metal' },
      { name: 'Commodities', value: 'commodity' },
      { name: 'Crypto', value: 'crypto' },
    ],
    supported_resolutions: ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M'],
  })
})

// 2. Server time (seconds) — Charting Library uses this to align bar timestamps
router.get('/time', (req, res) => {
  res.type('text/plain').send(String(Math.floor(Date.now() / 1000)))
})

// 3. Symbol search — used by the chart's symbol picker
router.get('/search', (req, res) => {
  const q = String(req.query.query || '').toUpperCase()
  const type = String(req.query.type || '').toLowerCase()
  const limit = parseInt(req.query.limit || '30', 10)
  let results = SUPPORTED_SYMBOLS
  if (q) results = results.filter(s => s.includes(q))
  if (type) {
    results = results.filter(s => {
      const seg = resolveTradeSegment(s).toLowerCase()
      return seg.includes(type) || (type === 'metal' && seg === 'metals')
    })
  }
  res.json(results.slice(0, limit).map(s => ({
    symbol: s,
    full_name: `vxness:${s}`,
    description: s,
    exchange: 'vxness',
    ticker: s,
    type: resolveTradeSegment(s).toLowerCase(),
  })))
})

// 4. Symbol info — called once per symbol when the chart loads it
router.get('/symbols', (req, res) => {
  const raw = String(req.query.symbol || '').toUpperCase()
  // Charting Library may send "vxness:XAUUSD" — strip the exchange prefix
  const symbol = raw.includes(':') ? raw.split(':')[1] : raw
  if (!SUPPORTED_SYMBOLS.includes(symbol)) {
    return res.status(404).json({ s: 'error', errmsg: `Unknown symbol ${symbol}` })
  }
  const seg = resolveTradeSegment(symbol)
  res.json({
    name: symbol,
    ticker: symbol,
    full_name: `vxness:${symbol}`,
    description: symbol,
    type: seg.toLowerCase(),
    exchange: 'vxness',
    listed_exchange: 'vxness',
    timezone: 'Etc/UTC',
    session: '24x7',
    minmov: 1,
    pricescale: priceScale(symbol),
    has_intraday: true,
    has_seconds: false,
    has_daily: true,
    has_weekly_and_monthly: true,
    supported_resolutions: ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M'],
    volume_precision: 2,
    data_status: 'streaming',
    currency_code: 'USD',
    original_currency_code: 'USD',
  })
})

// 5. Historical OHLC bars — the main data endpoint
// Charting Library calls this on first load and whenever user scrolls back in time.
router.get('/history', async (req, res) => {
  try {
    const raw = String(req.query.symbol || '').toUpperCase()
    const symbol = raw.includes(':') ? raw.split(':')[1] : raw
    const resolution = String(req.query.resolution || '1')
    const from = parseInt(req.query.from, 10) // seconds
    const to = parseInt(req.query.to, 10)     // seconds
    const countback = req.query.countback ? parseInt(req.query.countback, 10) : null

    if (!SUPPORTED_SYMBOLS.includes(symbol)) {
      return res.json({ s: 'error', errmsg: `Unknown symbol ${symbol}` })
    }
    const timeframe = RES_TO_TIMEFRAME[resolution]
    if (!timeframe) {
      return res.json({ s: 'error', errmsg: `Unsupported resolution ${resolution}` })
    }
    if (!Number.isFinite(to)) {
      return res.json({ s: 'error', errmsg: 'Missing "to" parameter' })
    }

    // Infoway returns at most ~1000 bars and walks BACKWARD from startTime.
    // countback (when present) is the authoritative bar count; otherwise derive from window.
    const secondsPerBar = RES_TO_SECONDS[resolution]
    const windowBars = Number.isFinite(from) && secondsPerBar
      ? Math.ceil((to - from) / secondsPerBar) + 5
      : 500
    const limit = Math.min(1000, Math.max(50, countback || windowBars))

    const startTime = new Date(to * 1000)
    const candles = await infowayService.getCandles(symbol, timeframe, startTime, limit)

    if (!candles.length) {
      return res.json({ s: 'no_data', nextTime: from ? from - secondsPerBar : undefined })
    }

    // Infoway returns candles with field .time (Date); sort ascending and drop bars before `from`
    const sorted = candles
      .map(c => ({
        t: Math.floor(new Date(c.time).getTime() / 1000),
        o: c.open, h: c.high, l: c.low, c: c.close,
        v: c.tickVolume ?? c.volume ?? 0,
      }))
      .filter(b => Number.isFinite(b.t) && Number.isFinite(from) ? b.t >= from : true)
      .sort((a, b) => a.t - b.t)

    if (!sorted.length) {
      return res.json({ s: 'no_data', nextTime: from ? from - secondsPerBar : undefined })
    }

    res.json({
      s: 'ok',
      t: sorted.map(b => b.t),
      o: sorted.map(b => b.o),
      h: sorted.map(b => b.h),
      l: sorted.map(b => b.l),
      c: sorted.map(b => b.c),
      v: sorted.map(b => b.v),
    })
  } catch (err) {
    console.error('[charts] /history error:', err.message)
    res.json({ s: 'error', errmsg: err.message })
  }
})

// 6. Quotes — optional, used by chart watchlist/symbol picker for last price
router.get('/quotes', (req, res) => {
  const symbols = String(req.query.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  const data = symbols.map(raw => {
    const symbol = raw.includes(':') ? raw.split(':')[1] : raw
    const price = infowayService.getPrice(symbol)
    if (!price) {
      return { s: 'error', n: raw, v: {} }
    }
    return {
      s: 'ok',
      n: raw,
      v: {
        ch: 0,
        chp: 0,
        short_name: symbol,
        exchange: 'vxness',
        description: symbol,
        lp: (price.bid + price.ask) / 2,
        ask: price.ask,
        bid: price.bid,
        open_price: price.bid,
        high_price: price.ask,
        low_price: price.bid,
        prev_close_price: price.bid,
        volume: 0,
      },
    }
  })
  res.json({ s: 'ok', d: data })
})

export default router
