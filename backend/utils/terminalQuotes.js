// Quote presentation for the desktop terminal.
//
// The web terminal never shows the raw LP quote: services/chargePricing.js
// renders bid unchanged and ask = bid + adminSpreadDelta. The desktop terminal
// has to agree to the last digit, otherwise the same account shows two
// different spreads depending on which client you opened.
//
// Resolving Charges is a full-collection read plus a per-symbol merge, so the
// result is memoised per (user, accountType) for CACHE_TTL_MS. Ticks arrive
// several times a second per symbol; recomputing there would hammer Mongo.

import Charges from '../models/Charges.js'
import { pipSize } from './symbolMeta.js'
import { resolveTradeSegment } from './tradeSegment.js'

const CACHE_TTL_MS = 30_000
const cache = new Map() // `${userId}:${accountTypeId}` -> { at, table }

function spreadDelta(symbol, spreadValue, spreadType, bid, ask) {
  const v = Number(spreadValue)
  if (!Number.isFinite(v) || v <= 0) return 0
  if (spreadType === 'PERCENTAGE') {
    const range = Number(ask) - Number(bid)
    return Number.isFinite(range) && range > 0 ? range * (v / 100) : 0
  }
  return v * pipSize(symbol)
}

/**
 * Builds a `symbol -> { spreadValue, spreadType }` table for one account.
 * `symbols` is the list to resolve (the full supported set, typically).
 */
export async function loadSpreadTable(userId, accountTypeId, symbols) {
  const key = `${userId}:${accountTypeId || ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.table

  // One read, then merge per symbol — Charges.getChargesForTrade accepts a
  // preloaded array precisely so this stays a single round-trip.
  const preloaded = await Charges.find({ isActive: true }).sort({ createdAt: -1 })
  const table = new Map()
  for (const symbol of symbols) {
    try {
      const c = await Charges.getChargesForTrade(
        userId, symbol, resolveTradeSegment(symbol), accountTypeId, preloaded
      )
      table.set(symbol, { spreadValue: c.spreadValue, spreadType: c.spreadType })
    } catch {
      table.set(symbol, { spreadValue: 0, spreadType: 'FIXED' })
    }
  }

  cache.set(key, { at: Date.now(), table })
  return table
}

/**
 * Applies the admin spread to a raw LP tick, matching the web terminal exactly:
 * bid passes through, ask becomes bid + delta. With no admin spread configured
 * the raw pair is returned untouched.
 */
export function applySpread(symbol, bid, ask, entry) {
  const b = Number(bid)
  const a = Number(ask)
  if (!Number.isFinite(b) || !Number.isFinite(a) || b <= 0 || a <= 0) {
    return { bid: b, ask: a }
  }
  const d = entry ? spreadDelta(symbol, entry.spreadValue, entry.spreadType, b, a) : 0
  if (!(d > 0)) return { bid: b, ask: a }
  return { bid: b, ask: b + d }
}

// Number of decimals the terminal should render for a symbol. Derived from
// pipSize so it can never drift from the spread/commission scaling.
export function digitsFor(symbol) {
  const ps = pipSize(symbol)
  if (!(ps > 0)) return 5
  return Math.max(0, Math.round(Math.log10(1 / ps)))
}

export function invalidateSpreadCache() {
  cache.clear()
}
