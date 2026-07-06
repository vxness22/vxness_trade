/**
 * Mirrors backend/utils/symbolMeta.js + commissionMath.js so the trading UI's bid/ask
 * match the price the backend will actually execute at.
 *
 * Admin enters spread and commission in the same per-asset unit:
 *   forex non-JPY → pips (0.0001),  forex JPY → pips (0.01),
 *   metals/commodities → cents (0.01),  crypto/indices → dollars (1).
 */

const CRYPTO_SYMBOLS = new Set([
  'BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BCHUSD', 'BNBUSD', 'SOLUSD', 'ADAUSD', 'DOGEUSD',
  'DOTUSD', 'MATICUSD', 'AVAXUSD', 'LINKUSD', 'TRXUSD', 'SHIBUSD', 'TONUSD', 'HBARUSD',
  'XLMUSD', 'ALGOUSD', 'VETUSD', 'ICPUSD', 'FILUSD', 'ETCUSD', 'XMRUSD', 'EOSUSD',
  'AAVEUSD', 'MKRUSD', 'COMPUSD', 'SNXUSD', 'YFIUSD', 'SUSHIUSD', 'NEARUSD', 'FTMUSD',
  'SANDUSD', 'MANAUSD', 'AXSUSD', 'GALAUSD', 'APEUSD', 'GMTUSD', 'OPUSD', 'ARBUSD',
  'PEPEUSD', 'ATOMUSD', 'UNIUSD',
])

const COMMODITY_SYMBOLS = new Set([
  'USOIL', 'UKOIL', 'BRENT', 'WTI', 'NGAS', 'COPPER',
])

const INDEX_SYMBOLS = new Set([
  'US30', 'US500', 'NAS100', 'US100', 'GER40', 'UK100', 'DJ30', 'DAX', 'FTSE', 'SPX', 'NDX',
  'JPN225', 'AUS200', 'HK50', 'FRA40', 'EU50', 'USTEC', 'DE30', 'SPX500',
])

function classify(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (!s) return 'forex'
  if (CRYPTO_SYMBOLS.has(s)) return 'crypto'
  if (COMMODITY_SYMBOLS.has(s)) return 'commodity'
  if (INDEX_SYMBOLS.has(s)) return 'index'
  if (s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD')) return 'metal'
  if (s.includes('JPY')) return 'jpy'
  return 'forex'
}

function pipSize(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (!s) return 0.00001
  const cls = classify(symbol)
  if (cls === 'index') return 1
  if (cls === 'crypto') return 0.01
  if (cls === 'commodity') return 0.01
  if (cls === 'metal') return 0.01
  if (cls === 'jpy') return 0.001
  return 0.00001
}

function getContractSize(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (s === 'XAUUSD') return 100
  if (s === 'XAGUSD') return 5000
  if (s === 'XPTUSD' || s === 'XPDUSD') return 100
  if (COMMODITY_SYMBOLS.has(s)) return 1000
  if (CRYPTO_SYMBOLS.has(s)) return 1
  if (INDEX_SYMBOLS.has(s)) return 1
  return 100000
}

function spreadToPriceDelta(spreadValue, spreadType, symbol, bid, ask) {
  if (!Number.isFinite(spreadValue) || spreadValue <= 0) return 0
  if (spreadType === 'PERCENTAGE') {
    const range = Number(ask) - Number(bid)
    if (!Number.isFinite(range)) return 0
    return range * (spreadValue / 100)
  }
  return spreadValue * pipSize(symbol)
}

/**
 * @param {number} bid — raw market bid
 * @param {number} ask — raw market ask
 * @param {string} symbol
 * @param {{ spread: number, spreadType?: string } | null | undefined} spreadEntry — from /api/charges/spreads
 */
export function adjustQuotesForAdminSpread(bid, ask, symbol, spreadEntry) {
  const b = Number(bid)
  const a = Number(ask)
  if (!Number.isFinite(b) || !Number.isFinite(a) || b <= 0 || a <= 0) {
    return { bid: b, ask: a }
  }
  const spreadRaw = Number(spreadEntry?.spread ?? spreadEntry?.spreadValue)
  if (!spreadEntry || !Number.isFinite(spreadRaw) || spreadRaw <= 0) {
    return { bid: b, ask: a }
  }
  const d = spreadToPriceDelta(
    spreadRaw,
    spreadEntry.spreadType || 'FIXED',
    symbol,
    b,
    a
  )
  if (!Number.isFinite(d) || d <= 0) return { bid: b, ask: a }
  return { bid: b - d, ask: a + d }
}

/**
 * Displayed BUY/SELL quotes when admin charges may be configured.
 * - If admin spread is configured: collapse the natural LP spread and show ask = bid + spread delta.
 * - If admin spread is NOT configured: pass through raw bid/ask unchanged.
 * Admin commission is NOT folded into the displayed ask anymore — backend charges it as a
 * separate dollar amount on trade open and surfaces it in the Positions table's Charges column.
 */
export function adjustQuotesForTradingDisplay(bid, ask, symbol, spreadEntry, _commissionEntry, _quantity = 1) {
  const b = Number(bid)
  const aRaw = Number(ask)
  if (!Number.isFinite(b) || !Number.isFinite(aRaw) || b <= 0 || aRaw <= 0) {
    return { bid: b, ask: aRaw }
  }

  const spreadRaw = Number(spreadEntry?.spread ?? spreadEntry?.spreadValue)
  const hasAdminSpread = spreadEntry && Number.isFinite(spreadRaw) && spreadRaw > 0

  if (!hasAdminSpread) {
    return { bid: b, ask: aRaw }
  }

  const askMarkup = spreadToPriceDelta(spreadRaw, spreadEntry.spreadType || 'FIXED', symbol, b, aRaw)
  return { bid: b, ask: b + askMarkup }
}

export { classify, pipSize, getContractSize }
