// Does money move correctly between the main wallet and a trading account?
// Drives /api/v1/wallet/* over HTTP the way the desktop terminal's transfer
// dialog does, against a throwaway user, account and wallet that this script
// creates and deletes. Nothing real is touched.
//
//   node server.js                 (in another shell, any port)
//   node scripts/testWalletTransfer.mjs [http://127.0.0.1:5000]
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

const BASE = (process.argv[2] || `http://127.0.0.1:${process.env.PORT || 5000}`) + '/api/v1'

const { default: User } = await import('../models/User.js')
const { default: Wallet } = await import('../models/Wallet.js')
const { default: TradingAccount } = await import('../models/TradingAccount.js')
const { default: AccountType } = await import('../models/AccountType.js')
const { default: Transaction } = await import('../models/Transaction.js')

await mongoose.connect(process.env.MONGODB_URI)

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok && detail) console.log(`          ${detail}`)
}

const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* empty body */ }
  return { status: res.status, json }
}

const stamp = Date.now()
const made = {}

try {
  made.user = await User.create({
    firstName: 'Wallet', lastName: 'Test',
    email: `wallet-test-${stamp}@example.invalid`,
    password: 'not-a-real-password',
    kycApproved: true,
  })
  made.type = await AccountType.create({
    name: `TestLive${stamp}`, minDeposit: 50, leverage: '1:100', isDemo: false,
  })
  made.live = await TradingAccount.create({
    userId: made.user._id, accountTypeId: made.type._id,
    accountId: `99${String(stamp).slice(-6)}`,
    leverage: '1:100', balance: 0, credit: 0, status: 'Active', isDemo: false,
  })
  made.demo = await TradingAccount.create({
    userId: made.user._id, accountTypeId: made.type._id,
    accountId: `88${String(stamp).slice(-6)}`,
    leverage: '1:100', balance: 10000, credit: 0, status: 'Active', isDemo: true,
  })
  made.wallet = await Wallet.create({ userId: made.user._id, balance: 500 })

  const token = jwt.sign({ id: String(made.user._id), typ: 'terminal' },
                         process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '15m' })
  const live = String(made.live._id)
  const walletNow = async () => (await Wallet.findById(made.wallet._id)).balance
  const acctNow = async () => (await TradingAccount.findById(live)).balance

  console.log('\n1) summary: the Wallet collection, and live accounts only\n')
  let r = await call('GET', '/wallet/summary', token)
  check('200', r.status === 200, JSON.stringify(r.json))
  check('main wallet reads 500', r.json?.main_wallet_balance === 500, String(r.json?.main_wallet_balance))
  check('exactly one account offered', r.json?.live_accounts?.length === 1,
        JSON.stringify(r.json?.live_accounts))
  check('the demo account is not one of them',
        !r.json?.live_accounts?.some(a => a.id === String(made.demo._id)))
  check('carries the fields the dialog reads',
        ['id', 'account_number', 'balance', 'margin_used', 'free_margin']
          .every(k => r.json?.live_accounts?.[0]?.[k] !== undefined),
        JSON.stringify(r.json?.live_accounts?.[0]))

  console.log('\n2) the account type\'s minimum first deposit still applies\n')
  r = await call('POST', '/wallet/transfer-main-to-trading', token, { to_account_id: live, amount: 10 })
  check('refused with 400', r.status === 400, JSON.stringify(r.json))
  check('and says why', /minimum first deposit/i.test(r.json?.detail || ''), r.json?.detail)

  console.log('\n3) main wallet -> trading account\n')
  r = await call('POST', '/wallet/transfer-main-to-trading', token, { to_account_id: live, amount: 200 })
  check('200', r.status === 200, JSON.stringify(r.json))
  check('reports wallet 300', r.json?.main_wallet_balance === 300, String(r.json?.main_wallet_balance))
  check('reports account 200', r.json?.account_balance === 200, String(r.json?.account_balance))
  check('wallet really is 300', await walletNow() === 300, String(await walletNow()))
  check('account really is 200', await acctNow() === 200, String(await acctNow()))

  console.log('\n4) more than the wallet holds moves nothing\n')
  r = await call('POST', '/wallet/transfer-main-to-trading', token, { to_account_id: live, amount: 1000 })
  check('refused with 400', r.status === 400, JSON.stringify(r.json))
  check('wallet untouched', await walletNow() === 300, String(await walletNow()))
  check('account untouched', await acctNow() === 200, String(await acctNow()))

  console.log('\n5) trading account -> main wallet\n')
  r = await call('POST', '/wallet/transfer-trading-to-main', token, { from_account_id: live, amount: 150 })
  check('200', r.status === 200, JSON.stringify(r.json))
  check('reports wallet 450', r.json?.main_wallet_balance === 450, String(r.json?.main_wallet_balance))
  check('reports account 50', r.json?.account_balance === 50, String(r.json?.account_balance))
  check('wallet really is 450', await walletNow() === 450, String(await walletNow()))
  check('account really is 50', await acctNow() === 50, String(await acctNow()))

  console.log('\n6) more than the account holds moves nothing\n')
  r = await call('POST', '/wallet/transfer-trading-to-main', token, { from_account_id: live, amount: 500 })
  check('refused with 400', r.status === 400, JSON.stringify(r.json))
  check('wallet untouched', await walletNow() === 450, String(await walletNow()))
  check('account untouched', await acctNow() === 50, String(await acctNow()))

  console.log('\n7) a demo account cannot reach the wallet\n')
  r = await call('POST', '/wallet/transfer-trading-to-main', token,
                 { from_account_id: String(made.demo._id), amount: 10 })
  check('refused with 400', r.status === 400, JSON.stringify(r.json))
  check('and says it is a demo account', /demo/i.test(r.json?.detail || ''), r.json?.detail)

  console.log('\n8) somebody else\'s token cannot move this money\n')
  const stranger = jwt.sign({ id: String(new mongoose.Types.ObjectId()), typ: 'terminal' },
                            process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '15m' })
  r = await call('POST', '/wallet/transfer-main-to-trading', stranger, { to_account_id: live, amount: 10 })
  check('never 200', r.status !== 200, String(r.status))
  check('account untouched', await acctNow() === 50, String(await acctNow()))

  console.log('\n9) amounts that are not amounts\n')
  for (const bad of [0, -5, 'abc', null]) {
    r = await call('POST', '/wallet/transfer-main-to-trading', token, { to_account_id: live, amount: bad })
    check(`${JSON.stringify(bad)} refused`, r.status === 400, String(r.status))
  }

  console.log('\n10) each transfer left the ledger row the blotter reads\n')
  const rows = await Transaction.find({ userId: made.user._id }).sort({ createdAt: 1 })
  check('two rows, no more', rows.length === 2, rows.map(t => `${t.type}:${t.amount}`).join(', '))
  check('one in, one out',
        rows.some(t => t.type === 'Transfer_To_Account' && t.amount === 200) &&
        rows.some(t => t.type === 'Transfer_From_Account' && t.amount === 150),
        rows.map(t => `${t.type}:${t.amount}`).join(', '))
  check('both Completed', rows.every(t => t.status === 'Completed'))

  r = await call('GET', `/wallet/transactions?account_id=${live}`, token)
  const items = r.json?.items || []
  check('the terminal lists both', items.length === 2, JSON.stringify(items.map(i => i.amount)))
  check('in is +200, out is -150',
        items.some(i => i.amount === 200) && items.some(i => i.amount === -150),
        items.map(i => i.amount).join(', '))
} finally {
  if (made.user) {
    await Transaction.deleteMany({ userId: made.user._id })
    await TradingAccount.deleteMany({ userId: made.user._id })
    await Wallet.deleteMany({ userId: made.user._id })
    await User.deleteOne({ _id: made.user._id })
  }
  if (made.type) await AccountType.deleteOne({ _id: made.type._id })
  console.log('\ntest rows removed')
  await mongoose.disconnect()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
