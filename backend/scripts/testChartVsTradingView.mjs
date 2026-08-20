// Does our chart draw the same candles TradingView draws?
//
//   node scripts/testChartVsTradingView.mjs [SYMBOL]
//
// Reads the SAME hourly klines the chart pipeline runs on, folds them with the
// SAME production code (foldBars + utils/sessionGrid), and diffs the result
// against TradingView's own OANDA series pulled over their public chart socket.
//
// It exists because "the chart looks wrong" is unfalsifiable, and because the
// two failures it was written to catch were both invisible at a glance:
// Infoway's 4h series interleaves two grids, and a UTC-midnight daily bucket
// silently produces a different close from the 17:00-New-York one TradingView
// uses. Both show up here as an exact count.
//
// Needs INFOWAY_API_KEY in the environment (backend/.env is enough) and outbound
// access to data.tradingview.com. It hits live services, so it is a diagnostic
// you run, not a unit test.

import WebSocket from 'ws'
import infowayService, { foldBars } from '../services/infowayService.js'
import { barStartSeconds, sessionTradingDate } from '../utils/sessionGrid.js'

const SYMBOL = (process.argv[2] || 'XAUUSD').toUpperCase()
const TV_SYMBOL = process.argv[3] || `OANDA:${SYMBOL}`

// Prices from two different brokers never agree to the last digit; anything
// inside this is the feeds disagreeing, not our bucketing being wrong.
const PRICE_TOLERANCE = 0.05 // percent

/* ── TradingView reference series ────────────────────────────────────────── */

function tvBars(symbol, resolution, count) {
  return new Promise((resolve, reject) => {
    const rnd = (p) => p + Math.random().toString(36).slice(2, 14)
    const frame = (m, p) => {
      const s = JSON.stringify({ m, p })
      return `~m~${s.length}~m~${s}`
    }
    const cs = rnd('cs_')
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', {
      headers: { Origin: 'https://data.tradingview.com' },
    })
    const bars = []
    const done = (err) => {
      try { ws.close() } catch { /* already closed */ }
      if (err) reject(err)
      else resolve([...new Map(bars.map((b) => [b[0], b])).values()]
        .sort((a, b) => a[0] - b[0])
        .map((b) => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4] })))
    }
    const timer = setTimeout(() => done(null), 25_000)

    ws.on('open', () => {
      ws.send(frame('set_auth_token', ['unauthorized_user_token']))
      ws.send(frame('chart_create_session', [cs, '']))
      ws.send(frame('resolve_symbol', [cs, 'sym_1', `={"symbol":"${symbol}","adjustment":"splits"}`]))
      ws.send(frame('create_series', [cs, 's1', 's1', 'sym_1', resolution, count, '']))
    })
    ws.on('error', (e) => { clearTimeout(timer); done(e) })
    ws.on('message', (raw) => {
      for (const part of raw.toString().split(/~m~\d+~m~/).filter(Boolean)) {
        if (part.startsWith('~h~')) { ws.send(`~m~${part.length}~m~${part}`); continue }
        let j
        try { j = JSON.parse(part) } catch { continue }
        if (j.m === 'timescale_update' || j.m === 'du') {
          for (const row of j.p?.[1]?.s1?.s || []) if (row.v) bars.push(row.v)
        }
        if (j.m === 'series_completed') { clearTimeout(timer); done(null) }
        if (j.m === 'critical_error' || j.m === 'symbol_error') {
          clearTimeout(timer); done(new Error(`TradingView: ${JSON.stringify(j.p)}`))
        }
      }
    })
  })
}

/* ── Comparison ──────────────────────────────────────────────────────────── */

const pctOff = (a, b) => (Math.abs(a - b) / Math.max(Math.abs(b), 1e-9)) * 100

function compare(label, ours, theirs) {
  const mine = new Map(ours.map((b) => [Math.floor(b.time.getTime() / 1000), b]))
  // The newest bar on either side is still forming and will differ by whatever
  // ticked in between, so it is not evidence of anything.
  const reference = theirs.slice(0, -1).filter((b) => mine.has(b.time))
  const missing = theirs.slice(0, -1).length - reference.length

  let worst = { pct: 0 }
  let offBy = 0
  for (const t of reference) {
    const m = mine.get(t.time)
    for (const f of ['open', 'high', 'low', 'close']) {
      const pct = pctOff(m[f], t[f])
      if (pct > worst.pct) {
        worst = { pct, field: f, time: t.time, ours: m[f], theirs: t[f] }
      }
      if (pct > PRICE_TOLERANCE) { offBy += 1; break }
    }
  }

  const ok = missing === 0 && offBy === 0
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(4)}  ` +
    `matched ${reference.length}  missing-bar ${missing}  price-off ${offBy}  ` +
    `worst ${worst.pct.toFixed(4)}%`
  )
  if (worst.field && worst.pct > PRICE_TOLERANCE) {
    console.log(
      `        worst: ${new Date(worst.time * 1000).toISOString()} ${worst.field} ` +
      `ours=${worst.ours} tradingview=${worst.theirs}`
    )
  }
  if (missing > 0) {
    const absent = theirs.slice(0, -1).filter((b) => !mine.has(b.time)).slice(0, 5)
    for (const b of absent) console.log(`        no bar at ${new Date(b.time * 1000).toISOString()}`)
  }
  return ok
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

const now = new Date()
let allOk = true

// Hourly is the source everything above it is folded from — check it first, so a
// failure further down cannot be blamed on the raw feed.
const hourly = await infowayService.getCandles(SYMBOL, '1h', now, 300)
if (!hourly.length) {
  console.error('No hourly klines came back — is INFOWAY_API_KEY set?')
  process.exit(1)
}
allOk = compare('1h', hourly, await tvBars(TV_SYMBOL, '60', 300)) && allOk

// Grid alignment, independent of price: every bar we emit must land where
// TradingView puts one.
for (const [res, period] of [['240', 14400], ['120', 7200], ['45', 2700]]) {
  const theirs = await tvBars(TV_SYMBOL, res, 200)
  const strays = theirs.filter((b) => barStartSeconds(b.time, period) !== b.time).length
  console.log(`${strays === 0 ? 'PASS' : 'FAIL'}  grid  ${res.padStart(3)}m  ` +
    `TradingView bars off our session grid: ${strays}/${theirs.length}`)
  allOk = strays === 0 && allOk
}

allOk = compare('4h', await infowayService.getCandles(SYMBOL, '4h', now, 120),
  await tvBars(TV_SYMBOL, '240', 140)) && allOk

// Daily bars are stamped at midnight UTC of the trading date; TradingView stamps
// them at the session open. Re-stamp theirs the same way before comparing, since
// the point of the check is the OHLC inside the bucket, not the label format.
const tvDaily = (await tvBars(TV_SYMBOL, '1D', 60)).map((b) => ({
  ...b,
  time: Math.floor(Date.parse(`${sessionTradingDate(b.time)}T00:00:00Z`) / 1000),
}))
allOk = compare('1D', await infowayService.getCandles(SYMBOL, '1d', now, 60), tvDaily) && allOk

// foldBars must not invent or lose price extremes: a bucket's high is the
// highest source high in it, full stop.
const refolded = foldBars(hourly, (sec) => barStartSeconds(sec, 14400))
const sane = refolded.every((b) => b.high >= b.low && b.high >= b.open && b.high >= b.close &&
  b.low <= b.open && b.low <= b.close)
console.log(`${sane ? 'PASS' : 'FAIL'}  fold  OHLC invariants across ${refolded.length} folded bars`)
allOk = sane && allOk

console.log(allOk ? '\nAll checks passed.' : '\nSome checks failed — see above.')
await infowayService.disconnect()
process.exit(allOk ? 0 : 1)
