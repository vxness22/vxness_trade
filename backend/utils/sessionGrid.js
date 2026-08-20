// Where a candle starts.
//
// TradingView does not lay its bars on the plain UTC grid — it anchors every
// resolution, 1m through 1M, at the instrument's SESSION start. For the FX /
// metals feed that is 17:00 New York, i.e. 21:00 UTC while New York is on EDT
// and 22:00 UTC while it is on EST.
//
// That single rule reproduces TradingView's whole grid, which is why the odd
// cases look inconsistent until you see it. Measured against TradingView's own
// OANDA:XAUUSD series on 2026-08-20:
//
//   res   bar-start offset inside the period    why
//   1m…1h  0        (plain UTC grid)            17:00 divides evenly into these
//   45m    0        (plain UTC grid)            75600s % 2700s == 0
//   3h     0        (plain UTC grid)            75600s % 10800s == 0
//   2h     +1h off the UTC grid                 75600s % 7200s == 3600
//   4h     +1h off the UTC grid                 75600s % 14400s == 3600
//   1D     opens 21:00 / 22:00 UTC              the session start itself
//
// Anchoring at 17:00 New York therefore gets every timeframe right at once,
// including the EST/EDT switch, instead of hard-coding a "+1 hour" fudge that
// would break every autumn.
//
// Crypto has no session — it runs 24x7 on the plain UTC grid — so callers pass
// anchorHourNY = null for those symbols and get UTC-aligned bars back.

const SESSION_START_HOUR_NY = 17

// Reading a wall clock in another timezone without pulling in a date library:
// ask Intl for New York's calendar fields, then re-read them as if they were UTC.
// The difference from the real instant IS that zone's offset, DST included.
const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function newYorkFields(ms) {
  const out = {}
  for (const p of NY_PARTS.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10)
  }
  // Intl reports midnight as hour 24 in some ICU builds — normalise it.
  if (out.hour === 24) out.hour = 0
  return out
}

// Seconds to ADD to a UTC instant to read it as New York wall-clock time.
// Negative in practice (-4h on EDT, -5h on EST).
export function newYorkOffsetSeconds(tsSec) {
  const ms = tsSec * 1000
  const f = newYorkFields(ms)
  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second)
  return Math.round((asIfUtc - Math.floor(ms / 1000) * 1000) / 1000)
}

/**
 * Start (epoch seconds) of the trading session that `tsSec` falls in — the most
 * recent 17:00 New York at or before it. Returns null when the symbol has no
 * session (crypto), which callers read as "use the plain UTC grid".
 */
export function sessionStartSeconds(tsSec, anchorHourNY = SESSION_START_HOUR_NY) {
  if (anchorHourNY == null) return null
  const offset = newYorkOffsetSeconds(tsSec)
  const nySecOfDay = ((tsSec + offset) % 86400 + 86400) % 86400
  let elapsed = nySecOfDay - anchorHourNY * 3600
  if (elapsed < 0) elapsed += 86400
  return tsSec - elapsed
}

/**
 * Snap an instant onto the bar grid for `periodSec`, anchored at the session
 * start. With anchorHourNY = null this degrades to the plain UTC grid, which is
 * what crypto wants.
 */
export function barStartSeconds(tsSec, periodSec, anchorHourNY = SESSION_START_HOUR_NY) {
  if (!(periodSec > 0)) return tsSec
  const anchor = sessionStartSeconds(tsSec, anchorHourNY)
  if (anchor == null) return Math.floor(tsSec / periodSec) * periodSec
  return anchor + Math.floor((tsSec - anchor) / periodSec) * periodSec
}

/**
 * True when `tsSec` falls in the hour a metals session pauses for settlement —
 * 17:00 to 18:00 New York, the first hour of the trading day.
 *
 * Metals stop for it and FX does not, which is not a guess: across TradingView's
 * OANDA hourly series, XAUUSD / XAGUSD / XPTUSD / XPDUSD have zero bars in that
 * hour over every session sampled, while EURUSD, GBPUSD, USDJPY and BTCUSD have
 * one in every session. Infoway mostly agrees — but it does occasionally emit a
 * thin bar there (once in 4711 hourly bars on XAUUSD), and because that bar
 * lands at the very start of the trading day it becomes the DAILY candle's open.
 * The one stray moved 25-Mar-2026's open by 20 dollars.
 */
export function isSessionBreak(tsSec, anchorHourNY = SESSION_START_HOUR_NY) {
  const anchor = sessionStartSeconds(tsSec, anchorHourNY)
  if (anchor == null) return false
  return tsSec >= anchor && tsSec < anchor + 3600
}

/**
 * The calendar date TradingView LABELS a session with, as 'YYYY-MM-DD'.
 *
 * The session that opens Sunday 17:00 New York is Monday's bar, not Sunday's, so
 * the label is taken from the New York date in the MIDDLE of the session rather
 * than at its start — half a day past the 17:00 open always lands on the right
 * calendar day, on both sides of a DST switch.
 */
export function sessionTradingDate(tsSec, anchorHourNY = SESSION_START_HOUR_NY) {
  const anchor = sessionStartSeconds(tsSec, anchorHourNY)
  if (anchor == null) {
    return new Date(Math.floor(tsSec / 86400) * 86400 * 1000).toISOString().slice(0, 10)
  }
  const mid = (anchor + 12 * 3600) * 1000
  const f = newYorkFields(mid)
  const mm = String(f.month).padStart(2, '0')
  const dd = String(f.day).padStart(2, '0')
  return `${f.year}-${mm}-${dd}`
}

/**
 * Epoch seconds a DAILY bar is stamped with: midnight UTC of the trading date.
 * That is the Charting Library's documented convention for daily bars, and it
 * puts the candle on the same calendar day TradingView shows it on.
 */
export function dailyBarSeconds(tsSec, anchorHourNY = SESSION_START_HOUR_NY) {
  return Math.floor(Date.parse(`${sessionTradingDate(tsSec, anchorHourNY)}T00:00:00Z`) / 1000)
}

export { SESSION_START_HOUR_NY }
