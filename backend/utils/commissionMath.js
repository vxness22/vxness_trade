// Commission math shared by tradeEngine and propTradingEngine.
// Admin enters commissionValue in the same per-asset unit used for spread:
//   forex non-JPY → pips,   forex JPY → pips (3-dec),   metals/commodities → cents,   crypto/indices → dollars.
// Backed by symbolMeta.pipSize so spread and commission scale identically per asset class.

import { pipSize } from './symbolMeta.js'

export function commissionPerLotDelta(symbol, commissionValue) {
  const cv = Number(commissionValue)
  if (!Number.isFinite(cv) || cv <= 0) return 0
  return cv * pipSize(symbol)
}

// Price delta to ADD to BUY execution price (embeds commission into the fill).
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
// Equals priceDelta * contractSize * quantity so it stays consistent with the embedded-in-price path.
export function commissionDollarAmount(symbol, quantity, openPrice, commissionType, commissionValue, contractSize) {
  const ct = String(commissionType || 'PER_LOT')
  const cv = Number(commissionValue)
  if (!Number.isFinite(cv) || cv <= 0) return 0
  if (ct === 'PERCENTAGE') {
    const tradeValue = Number(quantity) * Number(contractSize) * Number(openPrice)
    return tradeValue * (cv / 100)
  }
  const delta = commissionPriceDelta(symbol, cv, ct, quantity, openPrice)
  return delta * Number(contractSize) * Number(quantity)
}
