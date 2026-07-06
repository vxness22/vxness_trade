const INDICES = new Set([
  'US30', 'US500', 'NAS100', 'SPX500', 'GER40', 'UK100',
  'USTEC', 'DE30', 'DJ30', 'US100', 'NASDAQ', 'NAS'
])

export const formatPrice = (price, symbol) => {
  if (price === null || price === undefined || isNaN(price)) return '-'
  if (symbol?.includes('JPY')) return price.toFixed(3)
  if (['BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD'].includes(symbol)) return price.toFixed(2)
  if (INDICES.has(symbol)) return price.toFixed(2)
  return price.toFixed(5)
}
