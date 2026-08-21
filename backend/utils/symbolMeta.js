// Single source of truth for per-symbol price scaling and contract size.
// Both spread (Charges.spreadValue) and commission (Charges.commissionValue) are entered
// as a count of the smallest visible decimal unit (MT5 "point" convention). Admin's "N"
// always adds +N at the last decimal position of the displayed price:
//   forex non-JPY (5 dec display) → 1 unit = 0.00001 (e.g. EURUSD 1.16313 + 3 → 1.16316)
//   forex JPY     (3 dec display) → 1 unit = 0.001   (e.g. USDJPY 159.494 + 2 → 159.496)
//   metals XAUUSD (2 dec)         → 1 unit = 0.01    (e.g. 4442.93 + 3 → 4442.96)
//   metals XAGUSD (3 dec)         → 1 unit = 0.001
//   commodities  (2 dec)          → 1 unit = 0.01    (e.g. USOIL 62.30 + 5 → 62.35)
//   crypto       (2 dec)          → 1 unit = 0.01    (e.g. BTCUSD 75248.00 + 2 → 75248.02)
//   indices                       → 1 unit = $1 (index point)
//
// pipSize(symbol)      — price delta produced by spreadValue=1 / commissionValue=1
// contractSize(symbol) — quantity * contractSize * price = notional trade value
// classify(symbol)     — asset class string used by commissionMath and engines

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

// The single source of truth for "this is an index". Everything that needs the
// answer — contract size, pip size, the Charges segment, the instrument tab —
// reads it from here through classify(). It used to be duplicated in
// utils/tradeSegment.js and routes/prices.js with a different membership, and
// the lists drifted: ESP35 was missing from this one, so it was priced as a
// forex pair with a contract size of 100,000. A 0.01 lot would have carried
// $23m of notional instead of $233.
const INDEX_SYMBOLS = new Set([
  'US30', 'US500', 'NAS100', 'US100', 'GER40', 'UK100', 'DJ30', 'DAX', 'FTSE', 'SPX', 'NDX',
  'JPN225', 'AUS200', 'HK50', 'FRA40', 'ESP35', 'EU50', 'USTEC', 'DE30', 'SPX500',
])

export function classify(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (!s) return 'forex'
  if (CRYPTO_SYMBOLS.has(s)) return 'crypto'
  if (COMMODITY_SYMBOLS.has(s)) return 'commodity'
  if (INDEX_SYMBOLS.has(s)) return 'index'
  if (s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD')) return 'metal'
  if (s.includes('JPY')) return 'jpy'
  return 'forex'
}

// pipSize = price delta produced by spreadValue=1 / commissionValue=1.
// Matches the smallest visible decimal of the symbol's display digits so admin's "N"
// always lands at the last decimal position the user sees.
export function pipSize(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (!s) return 0.00001
  const cls = classify(symbol)
  if (cls === 'index') return 1
  if (cls === 'crypto') return 0.01                                 // 2-dec display
  if (cls === 'commodity') return 0.01                              // 2-dec display
  if (cls === 'metal') return 0.01                                  // all metals = cents
  if (cls === 'jpy') return 0.001                                   // 3-dec display
  return 0.00001                                                     // 5-dec forex
}

export function contractSize(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (s === 'XAUUSD') return 100
  if (s === 'XAGUSD') return 5000
  if (s === 'XPTUSD' || s === 'XPDUSD') return 100
  if (COMMODITY_SYMBOLS.has(s)) return 1000
  if (CRYPTO_SYMBOLS.has(s)) return 1
  if (INDEX_SYMBOLS.has(s)) return 1
  return 100000
}

export function isCrypto(symbol) { return classify(symbol) === 'crypto' }
export function isMetal(symbol) { return classify(symbol) === 'metal' }
export function isCommodity(symbol) { return classify(symbol) === 'commodity' }
export function isIndex(symbol) { return classify(symbol) === 'index' }

// USD value of one unit of a currency, using whatever USD pair is quotable.
// getPrice(symbol) -> { bid, ask } | null  (e.g. infowayService.getPrice, or a livePrices lookup)
//   EUR -> uses EURUSD (USD per EUR)
//   JPY -> uses USDJPY inverse (USD per JPY = 1 / (JPY per USD))
export function usdValueOf(ccy, getPrice) {
  const c = String(ccy || '').toUpperCase()
  if (c === 'USD') return 1
  if (typeof getPrice !== 'function') return null
  const direct = getPrice(c + 'USD')               // e.g. EURUSD -> USD per EUR
  if (direct && direct.bid && direct.ask) return (direct.bid + direct.ask) / 2
  const inverse = getPrice('USD' + c)              // e.g. USDJPY -> JPY per USD
  if (inverse && inverse.bid && inverse.ask) return 2 / (inverse.bid + inverse.ask)
  return null
}

// USD value of ONE unit of a symbol's QUOTE currency — the multiplier that turns
// a raw `Δprice * lots * contractSize` figure into real USD.
//
// This is the piece that was missing everywhere P&L was calculated. That raw
// product is denominated in the pair's QUOTE currency, not in dollars:
//   EURUSD  quote USD  -> already USD                          -> factor 1
//   USDJPY  quote JPY  -> yen; 1 JPY ~ $0.0069                 -> factor 1/145
//   GBPJPY  quote JPY  -> yen                                  -> factor 1/145
//   EURGBP  quote GBP  -> pounds; 1 GBP ~ $1.34                -> factor 1.34
// Booking the raw number as dollars overstates a USDJPY result ~145x.
//
// For a USDXXX pair the pair's own price IS "XXX per USD", so 1/price is the
// exact rate at that fill — no second lookup, no dependency on another symbol.
// Crosses resolve the quote currency through its own USD pair.
export function quoteToUsd(symbol, price, getPrice) {
  const s = String(symbol || '').toUpperCase()
  const cls = classify(s)

  // metals / crypto / commodities / indices are all quoted in USD already
  if (cls !== 'forex' && cls !== 'jpy') return 1

  const base = s.slice(0, 3)
  const quote = s.slice(3, 6)

  if (quote === 'USD') return 1

  if (base === 'USD') {
    const p = Number(price)
    if (p > 0) return 1 / p
    const viaFeed = usdValueOf(quote, getPrice)
    return viaFeed != null ? viaFeed : 1
  }

  const rate = usdValueOf(quote, getPrice)
  if (rate == null) {
    // Returning 1 here reproduces the original bug for this symbol. Every symbol
    // in the current feed resolves, so this firing means a new instrument was
    // added whose quote currency has no USD pair to convert through.
    console.warn(`[symbolMeta] quoteToUsd: no USD rate for ${quote} (${s}) — P&L will NOT be USD-converted`)
    return 1
  }
  return rate
}

// Realised/floating P&L in USD. The single entry point every engine and route
// should use — never the bare `Δprice * lots * contractSize` product.
export function pnlUsd(symbol, side, openPrice, closePrice, quantity, cs, getPrice) {
  const size = Number(cs) || contractSize(symbol)
  const raw = String(side).toUpperCase() === 'BUY'
    ? (closePrice - openPrice) * quantity * size
    : (openPrice - closePrice) * quantity * size
  return raw * quoteToUsd(symbol, closePrice, getPrice)
}

// Notional (position) value in USD. The base for margin, percentage commission
// and percentage swap — all three used to compute `qty * cs * price` and treat
// it as dollars, which is only true for USD-quoted symbols.
//   USD-quoted (XXXUSD + metals/crypto/commodities/indices): qty * cs * price
//   USD-base   (USDXXX):                                     qty * cs   (already USD)
//   cross      (neither side USD, e.g. EURGBP/GBPJPY):        qty * cs * usdValueOf(base)
export function notionalUsd(symbol, quantity, price, getPrice) {
  const s = String(symbol || '').toUpperCase()
  const cs = contractSize(s)
  const cls = classify(s)

  if (cls !== 'forex' && cls !== 'jpy') {
    // metals / crypto / commodities / indices are all USD-quoted
    return quantity * cs * price
  }

  const base = s.slice(0, 3)
  const quote = s.slice(3, 6)
  if (quote === 'USD') return quantity * cs * price   // XXXUSD: price = USD per base unit
  if (base === 'USD') return quantity * cs            // USDXXX: 1 lot = cs USD already

  const baseUsd = usdValueOf(base, getPrice)          // cross: convert base -> USD
  return baseUsd != null
    ? quantity * cs * baseUsd
    : quantity * cs * price                           // fallback (approx) if rate unavailable
}

// Margin required in USD for a position, leverage as a number (e.g. 500 for 1:500).
export function marginUsd(symbol, quantity, price, leverageNum, getPrice) {
  const lev = Number(leverageNum) || 100
  return Math.round((notionalUsd(symbol, quantity, price, getPrice) / lev) * 100) / 100
}
