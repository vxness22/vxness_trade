import infowayService from '../services/infowayService.js'
import { classify } from './symbolMeta.js'

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
  // Asked of symbolMeta rather than a second list kept here. The two used to be
  // maintained separately and fell out of step — JPN225, FRA40, AUS200, HK50 and
  // ESP35 were all indices to symbolMeta and Forex to this function, which put
  // them under the wrong Charges segment and the wrong instrument tab.
  if (classify(s) === 'index') return 'Indices'
  return 'Forex'
}
