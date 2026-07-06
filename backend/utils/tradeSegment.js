import infowayService from '../services/infowayService.js'

const INDEX_SYMBOLS = new Set([
  'US30', 'US500', 'NAS100', 'SPX500', 'GER40', 'UK100', 'USTEC', 'DE30', 'DJ30', 'US100'
])

/**
 * Derives Charges.segment from symbol (source of truth for commission / swap / close fees).
 * Ignores wrong client segment (e.g. everything sent as Forex).
 */
export function resolveTradeSegment(symbol, clientSegment = null) {
  if (!symbol || typeof symbol !== 'string') {
    return clientSegment && String(clientSegment).trim() ? String(clientSegment).trim() : 'Forex'
  }
  const s = symbol.trim().toUpperCase()
  if (s.includes('XAU') || s.includes('XAG') || s.includes('XPT') || s.includes('XPD')) return 'Metals'
  if (s.includes('OIL') || s.includes('BRENT') || s.includes('WTI') || s === 'NGAS' || s === 'COPPER') {
    return 'Commodities'
  }
  if (infowayService.isCrypto(s)) return 'Crypto'
  if (INDEX_SYMBOLS.has(s)) return 'Indices'
  return 'Forex'
}
