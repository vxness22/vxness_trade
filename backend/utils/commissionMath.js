// Commission math shared by tradeEngine and propTradingEngine.
// Admin enters commissionValue in the same per-asset unit used for spread:
//   forex non-JPY → pips,   forex JPY → pips (3-dec),   metals/commodities → cents,   crypto/indices → dollars.
// Backed by symbolMeta.pipSize so spread and commission scale identically per asset class.
//
// CURRENCY: a per-lot commission works out to `priceDelta * contractSize * qty`,
// which is denominated in the pair's QUOTE currency — the same trap that inflated
// P&L. On USDJPY a "3 pip" commission is 300 JPY (~$2), not $300. Every dollar
// figure returned here is converted to USD via symbolMeta.

import { pipSize, quoteToUsd, notionalUsd } from './symbolMeta.js'
import infowayService from '../services/infowayService.js'

const defaultGetPrice = (s) => infowayService.getPrice(s)

export function commissionPerLotDelta(symbol, commissionValue) {
  const cv = Number(commissionValue)
  if (!Number.isFinite(cv) || cv <= 0) return 0
  return cv * pipSize(symbol)
}

// Price delta to ADD to BUY execution price (embeds commission into the fill).
// This one stays in PRICE space, so no currency conversion applies.
export function commissionPriceDelta(symbol, commissionValue, commissionType, quantity, currentPrice) {
  const ct = String(commissionType || 'PER_LOT')
  const qty = Number(quantity) > 0 ? Number(quantity) : 1
  if (ct === 'PER_LOT') return commissionPerLotDelta(symbol, commissionValue)
  if (ct === 'PER_TRADE') return commissionPerLotDelta(symbol, commissionValue) / qty
  if (ct === 'PERCENTAGE') {
    const cv = Number(commissionValue)
    if (!Number.isFinite(cv) || cv <= 0) return 0
    return Number(currentPrice) * (cv / 100)
  }
  return 0
}

// Dollar amount to charge as a separate commission line (used for SELL open and on-close).
// Equals priceDelta * contractSize * quantity, converted from the quote currency to USD.
export function commissionDollarAmount(symbol, quantity, openPrice, commissionType, commissionValue, contractSize, getPrice = defaultGetPrice) {
  const ct = String(commissionType || 'PER_LOT')
  const cv = Number(commissionValue)
  if (!Number.isFinite(cv) || cv <= 0) return 0

  if (ct === 'PERCENTAGE') {
    // Percentage of the position's USD notional, not of the raw quote-ccy product.
    return notionalUsd(symbol, Number(quantity), Number(openPrice), getPrice) * (cv / 100)
  }

  const delta = commissionPriceDelta(symbol, cv, ct, quantity, openPrice)
  const quoteCcyAmount = delta * Number(contractSize) * Number(quantity)
  return quoteCcyAmount * quoteToUsd(symbol, Number(openPrice), getPrice)
}
