// One rule for "is this stop loss / take profit on a side that can actually work".
//
// A bracket sitting on the wrong side of the market is already true the moment
// it is written, so the SL/TP sweep fires it as soon as it looks — and the trade
// closes on its own with nothing on screen to explain why. From the desk it
// reads as trades vanishing by themselves.
//
// It was reaching the database because only the MODIFY endpoints checked. Opening
// a position carried sl/tp straight through with a `> 0` test and nothing else,
// on both the web route and the algo route, so any client could open a position
// that was already dead. Four of these are in the live history, each closed
// 180-792 seconds after it opened:
//
//   XAUUSD SELL open 4383.68  SL 4372.00   (a SELL's stop belongs ABOVE entry)
//   XAUUSD BUY  open 4029.50  SL 4037.34   (a BUY's stop belongs BELOW entry)
//   XAUUSD SELL open 4017.61  SL 3993.70
//   GBPUSD BUY  open  1.34940 SL 4372.00   (a gold level on a cable trade)
//
// The 180s floor is the three-minute minimum hold in the sweep: the bracket was
// hit instantly, and the close landed the moment that grace period lapsed. That
// is why the reports say the trade disappears a few minutes after opening.
//
// The level is judged against the CURRENT MARKET, never the entry. Moving a stop
// into profit — bought at 525, price now 530, stop to 526 — is ordinary trade
// management and must stay allowed; what cannot be allowed is a level the market
// has already passed.

// How far from the market a bracket may sit before it is treated as bad data
// rather than a wide stop. Mirrors MAX_BRACKET_DISTANCE in
// services/tradeEngine.js, which is the sweep's refusal-to-close threshold —
// storing a level the sweep would ignore is worse than refusing it up front.
const MAX_BRACKET_DISTANCE = 0.5

// A BUY is closed at the bid, a SELL at the ask — so that is the side of the
// book each bracket is measured against.
export function closingPrice(side, quote) {
  if (!quote || !(quote.bid > 0) || !(quote.ask > 0)) return null
  return String(side).toUpperCase() === 'BUY' ? quote.bid : quote.ask
}

/**
 * Returns an error string when `level` is unusable for `kind`, or null when it
 * is fine. A null/0/absent level is fine — that means "no bracket".
 *
 * kind: 'sl' | 'tp'
 */
export function bracketError(side, kind, level, ref, refLabel = 'current price') {
  if (level == null || !Number.isFinite(level) || level <= 0) return null
  if (!Number.isFinite(ref) || ref <= 0) return null   // no quote: cannot judge, so allow

  // Right side, wrong magnitude. A stop of 1.35 under a gold BUY is BELOW the
  // market, so the side test is happy with it, and the position opens carrying a
  // level that belongs to a different instrument entirely. It cannot be hit, so
  // nothing protects the trade, and if the pair is ever reversed it pays out
  // against a price that never traded — which is how a GBPUSD BUY with a stop of
  // 4372 minted $4,370,650.
  //
  // The sweep already refuses to CLOSE on a level this far out
  // (MAX_BRACKET_DISTANCE in services/tradeEngine.js). The same distance is
  // applied here so it cannot be stored in the first place; the two must move
  // together, since a bracket the sweep will not act on is not a bracket.
  if (Math.abs(level - ref) / ref > MAX_BRACKET_DISTANCE) {
    return `${kind === 'sl' ? 'Stop loss' : 'Take profit'} ${level} is not a level for this instrument ` +
           `(${refLabel} ${ref}). Check the price you entered.`
  }

  const isBuy = String(side).toUpperCase() === 'BUY'
  if (kind === 'sl') {
    if (isBuy && level >= ref) return `Stop loss must be below the ${refLabel} (${ref}) for a BUY`
    if (!isBuy && level <= ref) return `Stop loss must be above the ${refLabel} (${ref}) for a SELL`
  } else {
    if (isBuy && level <= ref) return `Take profit must be above the ${refLabel} (${ref}) for a BUY`
    if (!isBuy && level >= ref) return `Take profit must be below the ${refLabel} (${ref}) for a SELL`
  }
  return null
}

/**
 * Checks both brackets for an order about to be opened. Returns the first error,
 * or null when the pair is acceptable.
 *
 * Passing no usable quote returns null: refusing an order because the feed
 * blinked would be a worse failure than accepting a bracket we could not judge,
 * and the sweep's own distance guard still stands behind it.
 */
export function validateBrackets(side, sl, tp, quote) {
  const ref = closingPrice(side, quote)
  if (ref == null) return null
  return bracketError(side, 'sl', sl, ref) || bracketError(side, 'tp', tp, ref)
}

/**
 * Same test for a PENDING order, where the reference is the order's own trigger
 * price rather than the market — the brackets have to make sense against the
 * price the position will actually open at, which is the only thing known now.
 */
export function validatePendingBrackets(side, sl, tp, entryPrice) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  return bracketError(side, 'sl', sl, entryPrice, 'order price')
      || bracketError(side, 'tp', tp, entryPrice, 'order price')
}
