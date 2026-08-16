// Frontend mirror of backend utils/symbolMeta.js margin logic, so the order-panel
// "Margin Required" preview matches what the server will actually reserve.
//
// Correctly handles three cases instead of blindly multiplying by price:
//   USD-quoted (XXXUSD + metals/crypto/commodities/indices): notional = qty * cs * price
//   USD-base   (USDXXX):                                      notional = qty * cs   (already USD)
//   cross      (neither side USD, e.g. EURGBP/GBPJPY):        notional = qty * cs * usdValueOf(base)

const CRYPTO = new Set([
  'BTCUSD','ETHUSD','LTCUSD','XRPUSD','BCHUSD','BNBUSD','SOLUSD','ADAUSD','DOGEUSD',
  'DOTUSD','MATICUSD','AVAXUSD','LINKUSD','TRXUSD','SHIBUSD','TONUSD','HBARUSD',
  'XLMUSD','ALGOUSD','VETUSD','ICPUSD','FILUSD','ETCUSD','XMRUSD','EOSUSD',
  'AAVEUSD','MKRUSD','COMPUSD','SNXUSD','YFIUSD','SUSHIUSD','NEARUSD','FTMUSD',
  'SANDUSD','MANAUSD','AXSUSD','GALAUSD','APEUSD','GMTUSD','OPUSD','ARBUSD',
  'PEPEUSD','ATOMUSD','UNIUSD',
])
const COMMODITY = new Set(['USOIL','UKOIL','BRENT','WTI','NGAS','COPPER'])
const INDEX = new Set([
  'US30','US500','NAS100','US100','GER40','UK100','DJ30','DAX','FTSE','SPX','NDX',
  'JPN225','AUS200','HK50','FRA40','EU50','USTEC','DE30','SPX500',
])

export function contractSize(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (s === 'XAUUSD') return 100
  if (s === 'XAGUSD') return 5000
  if (s === 'XPTUSD' || s === 'XPDUSD') return 100
  if (COMMODITY.has(s)) return 1000
  if (CRYPTO.has(s)) return 1
  if (INDEX.has(s)) return 1
  return 100000
}

function isUsdQuotedNonForex(s) {
  return CRYPTO.has(s) || COMMODITY.has(s) || INDEX.has(s) ||
    s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD')
}

// USD value of one unit of a currency. getQuote(symbol) -> { bid, ask } | null
export function usdValueOf(ccy, getQuote) {
  const c = String(ccy || '').toUpperCase()
  if (c === 'USD') return 1
  const direct = getQuote && getQuote(c + 'USD')
  if (direct && direct.bid && direct.ask) return (direct.bid + direct.ask) / 2
  const inverse = getQuote && getQuote('USD' + c)
  if (inverse && inverse.bid && inverse.ask) return 2 / (inverse.bid + inverse.ask)
  return null
}

// USD value of ONE unit of a symbol's QUOTE currency — mirrors backend
// utils/symbolMeta.js `quoteToUsd`. `Δprice * lots * contractSize` is denominated
// in the pair's quote currency, NOT in dollars:
//   EURUSD -> USD already (1)   USDJPY -> yen (1/145)   EURGBP -> pounds (1.34)
export function quoteToUsd(symbol, price, getQuote) {
  const s = String(symbol || '').toUpperCase()
  if (isUsdQuotedNonForex(s)) return 1

  const base = s.slice(0, 3)
  const quote = s.slice(3, 6)
  if (quote === 'USD') return 1

  if (base === 'USD') {
    const p = Number(price)
    if (p > 0) return 1 / p
    const viaFeed = usdValueOf(quote, getQuote)
    return viaFeed != null ? viaFeed : 1
  }

  const rate = usdValueOf(quote, getQuote)
  return rate != null ? rate : 1
}

// Floating/realised P&L in USD, before commission and swap.
export function pnlUsd(symbol, side, openPrice, currentPrice, quantity, cs, getQuote) {
  const size = Number(cs) || contractSize(symbol)
  const raw = String(side).toUpperCase() === 'BUY'
    ? (currentPrice - openPrice) * quantity * size
    : (openPrice - currentPrice) * quantity * size
  return raw * quoteToUsd(symbol, currentPrice, getQuote)
}

// Position value in USD — the base for margin and any percentage-of-value figure.
export function notionalUsd(symbol, quantity, price, getQuote) {
  const s = String(symbol || '').toUpperCase()
  const cs = contractSize(s)

  if (isUsdQuotedNonForex(s)) return quantity * cs * price

  const base = s.slice(0, 3)
  const quote = s.slice(3, 6)
  if (quote === 'USD') return quantity * cs * price
  if (base === 'USD') return quantity * cs

  const baseUsd = usdValueOf(base, getQuote)
  return baseUsd != null ? quantity * cs * baseUsd : quantity * cs * price
}

// Returns margin in USD (number). leverageNum is numeric (e.g. 500 for 1:500).
export function marginUsd(symbol, quantity, price, leverageNum, getQuote) {
  const lev = Number(leverageNum) || 100
  return notionalUsd(symbol, quantity, price, getQuote) / lev
}
