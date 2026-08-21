// How many decimals an instrument's price is shown to, in one place.
//
// Kept in step with getDigits() in backend/routes/prices.js — the rules are the
// same, so a quote reads identically wherever it appears.
//
// This lived in four places: here, and three separate copies inside TradingPage.
// The copies knew about JPY, metals and exactly two coins, and nothing about
// indices, so US30 came out as 52958.23000 — five decimals on a price that has
// two, wide enough to spill out of the quote box it sits in. TradingPage now
// calls this instead of carrying its own.

const INDICES = new Set([
  'US30', 'US500', 'NAS100', 'GER40', 'UK100', 'JPN225', 'FRA40', 'AUS200', 'HK50',
  // Codes an older account or a renamed feed may still reference.
  'SPX500', 'ESP35', 'EU50', 'USTEC', 'DE30', 'DJ30', 'US100', 'NASDAQ', 'NAS',
])

/** Decimals for a symbol. */
export function digitsFor(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (!s) return 5
  // Indices are quoted in points and carry two decimals on the feed — checked
  // first, or JPN225 would match the JPY rule below and be shown to three.
  if (INDICES.has(s)) return 2
  if (s.includes('JPY')) return 3
  if (/^X(AU|AG|PT|PD)/.test(s)) return 2      // metals, like TradingView
  if (['BTCUSD', 'ETHUSD'].includes(s)) return 2
  return 5
}

export const formatPrice = (price, symbol) => {
  const n = Number(price)
  if (price === null || price === undefined || !Number.isFinite(n)) return '-'
  return n.toFixed(digitsFor(symbol))
}
