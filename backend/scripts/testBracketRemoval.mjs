// Can a bracket be cleared? modifyTrade's contract, exercised directly against a
// throwaway trade so the answer does not depend on a live position existing.
//
//   node scripts/testBracketRemoval.mjs
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const { default: tradeEngine } = await import('../services/tradeEngine.js')
const { default: Trade } = await import('../models/Trade.js')

await mongoose.connect(process.env.MONGODB_URI)

let pass = 0, fail = 0
const check = (label, got, want) => {
  const ok = got === want
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) console.log(`          expected ${want}, got ${got}`)
}

// A trade that exists only for this run, on no real account.
const doc = await Trade.create({
  userId: new mongoose.Types.ObjectId(),
  tradingAccountId: new mongoose.Types.ObjectId(),
  tradeId: `TEST-${Date.now()}`,
  symbol: 'XAUUSD', segment: 'Metals', side: 'BUY', orderType: 'MARKET',
  quantity: 0.01, openPrice: 4500, contractSize: 100, leverage: 100,
  marginUsed: 45, status: 'OPEN',
  stopLoss: 4400, sl: 4400, takeProfit: 4600, tp: 4600,
})
const reload = async () => Trade.findById(doc._id).lean()

try {
  console.log('\nStarting: SL 4400, TP 4600\n')

  let t = await reload()
  check('starts with the SL set', t.stopLoss, 4400)

  // Clear the stop, leave the target alone.
  await tradeEngine.modifyTrade(doc._id, null, undefined)
  t = await reload()
  check('null clears stopLoss', t.stopLoss, null)
  check('null clears the sl alias too', t.sl, null)
  check('undefined leaves takeProfit alone', t.takeProfit, 4600)
  check('undefined leaves the tp alias alone', t.tp, 4600)

  // Set it again.
  await tradeEngine.modifyTrade(doc._id, 4350, undefined)
  t = await reload()
  check('a number sets stopLoss', t.stopLoss, 4350)
  check('a number sets the sl alias', t.sl, 4350)
  check('take profit still untouched', t.takeProfit, 4600)

  // Clear the target.
  await tradeEngine.modifyTrade(doc._id, undefined, null)
  t = await reload()
  check('null clears takeProfit', t.takeProfit, null)
  check('null clears the tp alias', t.tp, null)
  check('stop loss still set', t.stopLoss, 4350)

  // Junk is not a level.
  await tradeEngine.modifyTrade(doc._id, 0, undefined)
  t = await reload()
  check('0 clears rather than setting zero', t.stopLoss, null)

  await tradeEngine.modifyTrade(doc._id, 4300, undefined)
  await tradeEngine.modifyTrade(doc._id, NaN, undefined)
  t = await reload()
  check('NaN clears rather than storing NaN', t.stopLoss, null)

  // Both at once.
  await tradeEngine.modifyTrade(doc._id, 4310, 4700)
  t = await reload()
  check('both set together (sl)', t.stopLoss, 4310)
  check('both set together (tp)', t.takeProfit, 4700)
  await tradeEngine.modifyTrade(doc._id, null, null)
  t = await reload()
  check('both cleared together (sl)', t.stopLoss, null)
  check('both cleared together (tp)', t.takeProfit, null)
} finally {
  await Trade.deleteOne({ _id: doc._id })
  console.log('\n  (throwaway trade deleted)')
}

console.log(`\n${pass} passed, ${fail} failed\n`)
await mongoose.disconnect()
process.exit(fail ? 1 : 0)
