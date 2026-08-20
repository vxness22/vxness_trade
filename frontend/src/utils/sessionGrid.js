// Where a candle starts — the browser-side copy of backend/utils/sessionGrid.js.
// Keep both in sync; the chart is only consistent while history (backend) and the
// live forming candle (here) agree on where a bar begins.
//
// TradingView anchors every resolution at the instrument's SESSION start rather
// than at UTC midnight. For the FX / metals feed that is 17:00 New York — 21:00
// UTC on EDT, 22:00 UTC on EST. See the backend file for the measurements that
// pin this down; the short version is that 1m…1h and 45m/3h land on the plain UTC
// grid because 17:00 divides evenly into them, while 2h, 4h and the daily bar do
// not, and only the session anchor explains all of them at once.
//
// Crypto has no session, so callers pass anchorHourNY = null and get the plain
// UTC grid back — which is also how TradingView draws it.

export const SESSION_START_HOUR_NY = 17

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
  if (out.hour === 24) out.hour = 0
  return out
}

// Seconds to ADD to a UTC instant to read it as New York wall-clock time.
export function newYorkOffsetSeconds(tsSec) {
  const ms = tsSec * 1000
  const f = newYorkFields(ms)
  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second)
  return Math.round((asIfUtc - Math.floor(ms / 1000) * 1000) / 1000)
}

// Start (epoch seconds) of the session `tsSec` falls in, or null for 24x7 symbols.
export function sessionStartSeconds(tsSec, anchorHourNY = SESSION_START_HOUR_NY) {
  if (anchorHourNY == null) return null
  const offset = newYorkOffsetSeconds(tsSec)
  const nySecOfDay = (((tsSec + offset) % 86400) + 86400) % 86400
  let elapsed = nySecOfDay - anchorHourNY * 3600
  if (elapsed < 0) elapsed += 86400
  return tsSec - elapsed
}

// Snap an instant onto the bar grid for `periodSec`, anchored at the session start.
export function barStartSeconds(tsSec, periodSec, anchorHourNY = SESSION_START_HOUR_NY) {
  if (!(periodSec > 0)) return tsSec
  const anchor = sessionStartSeconds(tsSec, anchorHourNY)
  if (anchor == null) return Math.floor(tsSec / periodSec) * periodSec
  return anchor + Math.floor((tsSec - anchor) / periodSec) * periodSec
}

// The calendar date TradingView labels a session with, as 'YYYY-MM-DD'. The
// session opening Sunday 17:00 New York is Monday's bar, so the label is read
// from the middle of the session, which lands on the right day either side of a
// daylight-saving switch.
export function sessionTradingDate(tsSec, anchorHourNY = SESSION_START_HOUR_NY) {
  const anchor = sessionStartSeconds(tsSec, anchorHourNY)
  if (anchor == null) {
    return new Date(Math.floor(tsSec / 86400) * 86400 * 1000).toISOString().slice(0, 10)
  }
  const f = newYorkFields((anchor + 12 * 3600) * 1000)
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`
}

// Epoch seconds a DAILY bar is stamped with: midnight UTC of the trading date.
export function dailyBarSeconds(tsSec, anchorHourNY = SESSION_START_HOUR_NY) {
  return Math.floor(Date.parse(`${sessionTradingDate(tsSec, anchorHourNY)}T00:00:00Z`) / 1000)
}

// True when the session a bar belongs to is a weekend one — i.e. the instrument
// is shut. Friday's close rolls into "Saturday" and Sunday evening already
// carries Monday's date, which is exactly the window TradingView leaves blank.
export function isClosedSession(tsSec, anchorHourNY = SESSION_START_HOUR_NY) {
  if (anchorHourNY == null) return false
  const day = new Date(`${sessionTradingDate(tsSec, anchorHourNY)}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}
