// Replays the positions that closed themselves against the new bracket guard,
// plus the ordinary cases that must keep working.
//
//   node scripts/testBracketGuard.mjs
import { validateBrackets, validatePendingBrackets } from '../utils/bracketGuard.js'

let pass = 0, fail = 0
const check = (name, got, wantRejected) => {
  const rejected = got !== null
  const ok = rejected === wantRejected
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (got) console.log(`          → ${got}`)
  if (!ok) console.log(`          expected ${wantRejected ? 'REJECT' : 'ACCEPT'}, got ${rejected ? 'REJECT' : 'ACCEPT'}`)
}

// Half a point of spread either side of the entry, which is what these
// instruments actually quote at.
const q = (mid, sp = 0.3) => ({ bid: mid - sp / 2, ask: mid + sp / 2 })

console.log('\nPositions from the live history that closed themselves — all must now be REJECTED\n')
// XAUUSD SELL open 4383.68, SL 4372 (below entry — a SELL stops out ABOVE). Held 181s.
check('XAUUSD SELL @4383.68 with SL 4372',
      validateBrackets('SELL', 4372, null, q(4383.68)), true)
// XAUUSD BUY open 4029.50, SL 4037.34 (above entry — a BUY stops out BELOW).
check('XAUUSD BUY  @4029.50 with SL 4037.34',
      validateBrackets('BUY', 4037.34, null, q(4029.50)), true)
// XAUUSD SELL open 4017.61, SL 3993.70. Held 180s.
check('XAUUSD SELL @4017.61 with SL 3993.70',
      validateBrackets('SELL', 3993.70, null, q(4017.61)), true)
// GBPUSD BUY open 1.34940, SL 4372 — a gold level on cable. Paid out $4,370,650.
check('GBPUSD BUY  @1.34940 with SL 4372',
      validateBrackets('BUY', 4372, null, q(1.34940, 0.00016)), true)

console.log('\nOrdinary brackets — all must be ACCEPTED\n')
check('XAUUSD BUY  @4383.68, SL 4372 / TP 4400',
      validateBrackets('BUY', 4372, 4400, q(4383.68)), false)
check('XAUUSD SELL @4383.68, SL 4400 / TP 4360',
      validateBrackets('SELL', 4400, 4360, q(4383.68)), false)
check('no brackets at all',
      validateBrackets('BUY', null, null, q(4383.68)), false)
check('brackets sent as 0 (means none)',
      validateBrackets('SELL', 0, 0, q(4383.68)), false)
check('EURUSD BUY  @1.14000, SL 1.13900 / TP 1.14200',
      validateBrackets('BUY', 1.13900, 1.14200, q(1.14000, 0.00012)), false)

console.log('\nTake profit on the wrong side — must be REJECTED\n')
check('XAUUSD BUY  @4383.68 with TP 4370 (below)',
      validateBrackets('BUY', null, 4370, q(4383.68)), true)
check('XAUUSD SELL @4383.68 with TP 4400 (above)',
      validateBrackets('SELL', null, 4400, q(4383.68)), true)

console.log('\nNo usable quote — must ACCEPT rather than block trading on a feed blip\n')
check('quote missing',       validateBrackets('BUY', 4372, null, null), false)
check('quote is zero',       validateBrackets('BUY', 4372, null, { bid: 0, ask: 0 }), false)

console.log('\nPending orders — judged against the trigger price, not the market\n')
check('buy limit @4300 with SL 4310 (above trigger)',
      validatePendingBrackets('buy', 4310, null, 4300), true)
check('buy limit @4300 with SL 4290 / TP 4350',
      validatePendingBrackets('buy', 4290, 4350, 4300), false)
check('sell stop @4200 with SL 4190 (below trigger)',
      validatePendingBrackets('sell', 4190, null, 4200), true)
check('sell stop @4200 with SL 4210 / TP 4150',
      validatePendingBrackets('sell', 4210, 4150, 4200), false)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
