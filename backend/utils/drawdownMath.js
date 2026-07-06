// Single source of truth for OVERALL drawdown %, supporting both modes.
// Daily drawdown stays day-start based (handled in ChallengeAccount.updateEquity);
// this only governs the OVERALL limit which fundedfriday runs as STATIC or TRAILING.
//
//   STATIC   — measured from the starting balance:  (initialBalance - lowestEquityOverall) / initialBalance
//   TRAILING — measured from the running peak/high-water mark: (peak - currentEquity) / peak
//
// Returned value is a non-negative percentage (0 = no drawdown).
export function overallDrawdownPercent({ drawdownType, initialBalance, highestEquity, lowestEquityOverall, currentEquity }) {
  if (drawdownType === 'TRAILING') {
    const peak = Math.max(highestEquity || 0, currentEquity || 0, initialBalance || 0)
    if (!peak) return 0
    return Math.max(0, ((peak - (currentEquity || 0)) / peak) * 100)
  }
  // STATIC (default)
  const base = initialBalance || 0
  if (!base) return 0
  const low = (lowestEquityOverall == null) ? currentEquity : lowestEquityOverall
  return Math.max(0, ((base - low) / base) * 100)
}
