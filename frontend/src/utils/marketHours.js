// Single source of truth (frontend) for "is this instrument tradable right now?"
// Mirrors backend/utils/marketHours.js — keep both in sync.
//
// Rule:
//   - Crypto trades 24/7 → always open (including weekends).
//   - Everything else (forex, metals, commodities, indices) follows the
//     traditional FX week: closed on Saturday and Sunday.
//
// Weekends are evaluated in UTC so the open/closed window is identical for every
// user regardless of their local timezone (the FX week is a global concept).

import { classify } from '../services/chargePricing'

// Instruments that stay tradable on weekends in addition to crypto.
// Add symbols here (uppercase) to keep specific instruments open on Sat/Sun.
const WEEKEND_OPEN_EXTRA = new Set([])

// True for instruments whose market never closes (crypto + any manual extras).
export function isWeekendOpenSymbol(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (WEEKEND_OPEN_EXTRA.has(s)) return true
  return classify(s) === 'crypto'
}

// True when `now` falls on the FX weekend in UTC.
// getUTCDay(): 0 = Sunday ... 6 = Saturday.
export function isForexWeekend(now = new Date()) {
  const day = now.getUTCDay()
  return day === 0 || day === 6
}

// True when the given symbol can be traded at `now`.
// Crypto/weekend-open symbols are always tradable; the rest are blocked on weekends.
export function isMarketOpen(symbol, now = new Date()) {
  if (isWeekendOpenSymbol(symbol)) return true
  return !isForexWeekend(now)
}

// Short human-readable reason when a symbol is currently untradable (or null when open).
export function marketClosedReason(symbol, now = new Date()) {
  if (isMarketOpen(symbol, now)) return null
  return 'Market closed — weekend'
}
