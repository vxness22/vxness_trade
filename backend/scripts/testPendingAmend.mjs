// Can a resting order be amended from the WEB, the way the terminal can amend
// one through /api/v1? Drives PUT /api/trade/pending/:id against a throwaway
// user, account and order, then deletes them.
//
//   node server.js                          (in another shell)
//   node scripts/testPendingAmend.mjs [http://127.0.0.1:5000]
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

const BASE = (process.argv[2] || `http://127.0.0.1:${process.env.PORT || 5000}`) + '/api/trade'

const { default: User } = await import('../models/User.js')
const { default: TradingAccount } = await import('../models/TradingAccount.js')
const { default: AccountType } = await import('../models/AccountType.js')
const { default: Trade } = await import('../models/Trade.js')

await mongoose.connect(process.env.MONGODB_URI)

let pass = 0, fail = 0
const check = (l, ok, d = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}`)
  if (!ok && d) console.log(`        ${d}`)
}

const stamp = Date.now()
const made = {}
try {
  made.type = await AccountType.create({ name: `WP${stamp}`, minDeposit: 0, leverage: '1:100', isActive: true })
  made.user = await User.create({
    firstName: 'Web', lastName: 'Pending', email: `webpend-${stamp}@example.invalid`,
    password: 'not-a-real-password', kycApproved: true,
  })
  made.acct = await TradingAccount.create({
    userId: made.user._id, accountTypeId: made.type._id, accountId: `44${String(stamp).slice(-6)}`,
    leverage: '1:100', balance: 5000, status: 'Active',
  })
  // A BUY LIMIT well below the market, so a price move stays a legal limit.
  made.order = await Trade.create({
    userId: made.user._id, tradingAccountId: made.acct._id, tradeId: `WPO-${stamp}`,
    symbol: 'EURUSD', segment: 'Forex', side: 'BUY', orderType: 'BUY_LIMIT',
    quantity: 0.10, openPrice: 0.9000, pendingPrice: 0.9000,
    contractSize: 100000, leverage: 100, marginUsed: 90, status: 'PENDING',
  })

  const token = jwt.sign({ id: String(made.user._id) },
                         process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '15m' })
  const call = async (path, body, method = 'PUT') => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let json = null
    try { json = await res.json() } catch { /* empty */ }
    return { status: res.status, json }
  }

  console.log('\n1) the trigger price moves\n')
  let r = await call(`/pending/${made.order._id}`, { price: 0.9500 })
  check('200', r.status === 200, JSON.stringify(r.json).slice(0, 160))
  let fresh = await Trade.findById(made.order._id)
  check('openPrice and pendingPrice both moved',
        fresh.openPrice === 0.9500 && fresh.pendingPrice === 0.9500,
        `${fresh.openPrice}/${fresh.pendingPrice}`)
  check('margin was recalculated', fresh.marginUsed !== 90, String(fresh.marginUsed))

  console.log('\n2) size and brackets\n')
  r = await call(`/pending/${made.order._id}`, { lots: 0.25, sl: 0.9000, tp: 1.0000 })
  check('200', r.status === 200, JSON.stringify(r.json).slice(0, 160))
  fresh = await Trade.findById(made.order._id)
  check('lots', fresh.quantity === 0.25, String(fresh.quantity))
  check('sl in both spellings', fresh.sl === 0.9 && fresh.stopLoss === 0.9, `${fresh.sl}/${fresh.stopLoss}`)
  check('tp in both spellings', fresh.tp === 1 && fresh.takeProfit === 1, `${fresh.tp}/${fresh.takeProfit}`)

  console.log('\n3) a bracket on the wrong side of the TRIGGER is refused\n')
  r = await call(`/pending/${made.order._id}`, { sl: 1.2000 })   // stop above a BUY's entry
  check('400', r.status === 400, JSON.stringify(r.json))
  fresh = await Trade.findById(made.order._id)
  check('and nothing changed', fresh.sl === 0.9, String(fresh.sl))

  console.log('\n4) clearing a bracket\n')
  r = await call(`/pending/${made.order._id}`, { sl: null })
  fresh = await Trade.findById(made.order._id)
  check('sl cleared', r.status === 200 && !fresh.sl, String(fresh.sl))

  console.log('\n5) nonsense is refused\n')
  for (const bad of [{ price: 0 }, { price: -1 }, { lots: 0 }, {}]) {
    r = await call(`/pending/${made.order._id}`, bad)
    check(`${JSON.stringify(bad)} -> 400`, r.status === 400, String(r.status))
  }

  console.log('\n6) only a PENDING order can be amended\n')
  await Trade.updateOne({ _id: made.order._id }, { $set: { status: 'OPEN' } })
  r = await call(`/pending/${made.order._id}`, { price: 0.9600 })
  check('an open trade is refused', r.status === 400, JSON.stringify(r.json))
  await Trade.updateOne({ _id: made.order._id }, { $set: { status: 'PENDING' } })

  console.log('\n7) somebody else cannot touch it\n')
  const stranger = jwt.sign({ id: String(new mongoose.Types.ObjectId()) },
                            process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '15m' })
  const res = await fetch(`${BASE}/pending/${made.order._id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stranger}` },
    body: JSON.stringify({ price: 0.9700 }),
  })
  check('never 200', res.status !== 200, String(res.status))
  fresh = await Trade.findById(made.order._id)
  check('and the price is untouched', fresh.openPrice === 0.9500, String(fresh.openPrice))
} finally {
  if (made.user) {
    await Trade.deleteMany({ userId: made.user._id })
    await TradingAccount.deleteMany({ userId: made.user._id })
    await User.deleteOne({ _id: made.user._id })
  }
  if (made.type) await AccountType.deleteOne({ _id: made.type._id })
  console.log('\ntest rows removed')
  await mongoose.disconnect()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
