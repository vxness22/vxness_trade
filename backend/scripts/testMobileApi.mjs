// Does /api/v1 answer everything the mobile app asks for on its main screens?
//
// Drives the endpoints over HTTP against a throwaway user, account, manager and
// copy subscription that this script creates and deletes. Nothing real is
// touched.
//
//   node server.js                          (in another shell, any port)
//   node scripts/testMobileApi.mjs [http://127.0.0.1:5000]
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

const BASE = (process.argv[2] || `http://127.0.0.1:${process.env.PORT || 5000}`) + '/api/v1'

const { default: User } = await import('../models/User.js')
const { default: TradingAccount } = await import('../models/TradingAccount.js')
const { default: AccountType } = await import('../models/AccountType.js')
const { default: MasterTrader } = await import('../models/MasterTrader.js')
const { default: CopyFollower } = await import('../models/CopyFollower.js')
const { default: Trade } = await import('../models/Trade.js')

await mongoose.connect(process.env.MONGODB_URI)

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok && detail) console.log(`          ${detail}`)
}

let TOKEN = ''
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* empty */ }
  return { status: res.status, json }
}

const stamp = Date.now()
const made = {}

try {
  made.type = await AccountType.create({
    name: `MobileTest${stamp}`, minDeposit: 0, leverage: '1:100', isDemo: false, isActive: true,
  })
  made.user = await User.create({
    firstName: 'Mobile', lastName: 'Test',
    email: `mobile-test-${stamp}@example.invalid`, password: 'not-a-real-password',
    kycApproved: true,
  })
  made.account = await TradingAccount.create({
    userId: made.user._id, accountTypeId: made.type._id,
    accountId: `77${String(stamp).slice(-6)}`,
    leverage: '1:100', balance: 5000, credit: 100, status: 'Active', isDemo: false,
  })
  // A manager for the PAMM screen, and a closed trade for the performance one.
  made.masterUser = await User.create({
    firstName: 'Manager', lastName: 'One',
    email: `manager-${stamp}@example.invalid`, password: 'not-a-real-password',
  })
  made.masterAccount = await TradingAccount.create({
    userId: made.masterUser._id, accountTypeId: made.type._id,
    accountId: `66${String(stamp).slice(-6)}`, leverage: '1:100', balance: 10000, status: 'Active',
  })
  made.master = await MasterTrader.create({
    userId: made.masterUser._id, tradingAccountId: made.masterAccount._id,
    status: 'ACTIVE', displayName: 'Manager One', description: 'Test manager',
    requestedCommissionPercentage: 20, approvedCommissionPercentage: 20,
    stats: { totalFollowers: 3, activeFollowers: 2, totalTrades: 40, winRate: 62.5, totalProfitGenerated: 900 },
  })
  made.closed = await Trade.create({
    userId: made.user._id, tradingAccountId: made.account._id,
    tradeId: `MT-${stamp}`, symbol: 'EURUSD', segment: 'Forex', side: 'BUY', orderType: 'MARKET',
    quantity: 0.10, openPrice: 1.1000, closePrice: 1.1050, contractSize: 100000, leverage: 100,
    marginUsed: 110, realizedPnl: 50, commission: 2, swap: 0,
    status: 'CLOSED', openedAt: new Date(Date.now() - 3600e3), closedAt: new Date(),
  })

  TOKEN = jwt.sign({ id: String(made.user._id), typ: 'terminal' },
                   process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '15m' })
  const acct = String(made.account._id)

  console.log('\n1) profile\n')
  let r = await call('GET', '/profile')
  check('GET /profile 200', r.status === 200, JSON.stringify(r.json))
  check('carries the fields the screen reads',
        ['email', 'full_name', 'kyc_approved', 'wallet_balance'].every(k => r.json?.[k] !== undefined),
        JSON.stringify(r.json))
  r = await call('PUT', '/profile', { first_name: 'Renamed', phone: '9876543210' })
  check('PUT /profile 200', r.status === 200, JSON.stringify(r.json))
  check('the change stuck', r.json?.first_name === 'Renamed' && r.json?.phone === '9876543210',
        JSON.stringify(r.json))
  r = await call('PUT', '/profile', {})
  check('empty update refused', r.status === 400, String(r.status))

  console.log('\n2) push tokens\n')
  r = await call('POST', '/profile/push-token', { token: 'ExponentPushToken[test]', platform: 'android' })
  check('registered', r.status === 200, JSON.stringify(r.json))
  await call('POST', '/profile/push-token', { token: 'ExponentPushToken[test]', platform: 'android' })
  let u = await User.findById(made.user._id)
  check('re-registering the same device does not duplicate', u.pushTokens.length === 1,
        JSON.stringify(u.pushTokens))
  r = await call('DELETE', '/profile/push-token', { token: 'ExponentPushToken[test]' })
  u = await User.findById(made.user._id)
  check('removed on sign-out', r.status === 200 && u.pushTokens.length === 0, JSON.stringify(u.pushTokens))

  console.log('\n3) instruments\n')
  r = await call('GET', '/instruments/')
  check('200 with a catalogue', r.status === 200 && (r.json?.items || []).length > 50,
        String((r.json?.items || []).length))
  const eur = (r.json?.items || []).find(i => i.symbol === 'EURUSD')
  check('EURUSD carries name/digits/contract size',
        !!eur && eur.digits > 0 && eur.contract_size > 0, JSON.stringify(eur))
  r = await call('GET', '/instruments/prices/all')
  check('prices 200', r.status === 200, String(r.status))
  const row = (r.json?.items || [])[0]
  check('a price row has bid/ask and a market_open flag',
        !!row && row.bid != null && row.ask != null && typeof row.market_open === 'boolean',
        JSON.stringify(row))

  console.log('\n4) accounts\n')
  r = await call('GET', `/accounts/${acct}/summary`)
  check('summary 200', r.status === 200, JSON.stringify(r.json))
  check('equity = balance + credit when nothing is open',
        r.json?.equity === 5100 && r.json?.balance === 5000, JSON.stringify(r.json))
  check('fields Home reads are present',
        ['floating_pnl', 'free_margin', 'margin_level', 'open_positions_count']
          .every(k => r.json?.[k] !== undefined), JSON.stringify(r.json))
  r = await call('GET', '/accounts/available-groups')
  check('groups 200', r.status === 200 && Array.isArray(r.json?.items), JSON.stringify(r.json).slice(0, 120))
  r = await call('POST', '/accounts/open', { group_id: String(made.type._id) })
  check('opened a new account', r.status === 200 && !!r.json?.account_id, JSON.stringify(r.json))
  if (r.json?.account_id) made.extraAccount = r.json.account_id
  r = await call('POST', '/accounts/open', { group_id: String(new mongoose.Types.ObjectId()) })
  check('unknown group refused', r.status === 400, String(r.status))

  console.log('\n5) portfolio\n')
  r = await call('GET', `/portfolio/summary?account_id=${acct}`)
  check('summary 200', r.status === 200, JSON.stringify(r.json).slice(0, 150))
  check('the six fields the screen reads',
        ['balance', 'equity', 'total_equity', 'total_unrealized_pnl', 'today_pnl', 'open_positions_count']
          .every(k => r.json?.[k] !== undefined), JSON.stringify(r.json).slice(0, 200))
  check('today_pnl counts the closed trade', r.json?.today_pnl === 50, String(r.json?.today_pnl))
  r = await call('GET', `/portfolio/performance?period=1m&account_id=${acct}`)
  check('performance 200', r.status === 200, String(r.status))
  check('curve, stats, breakdowns all present',
        Array.isArray(r.json?.equity_curve) && !!r.json?.stats &&
        Array.isArray(r.json?.symbol_breakdown) && Array.isArray(r.json?.monthly_breakdown),
        JSON.stringify(r.json).slice(0, 160))
  check('one closed trade, one win', r.json?.stats?.total_trades === 1 && r.json?.stats?.wins === 1,
        JSON.stringify(r.json?.stats))

  console.log('\n6) social / PAMM\n')
  r = await call('GET', '/social/mamm-pamm?page=1&per_page=50')
  check('managers 200', r.status === 200 && Array.isArray(r.json?.items), String(r.status))
  const mine = (r.json?.items || []).find(m => m.id === String(made.master._id))
  check('our manager is listed with real stats',
        !!mine && mine.manager_name === 'Manager One' && mine.performance_fee_pct === 20 &&
        mine.active_investors === 2, JSON.stringify(mine))
  r = await call('GET', '/social/my-allocations')
  check('allocations 200 and empty to start', r.status === 200 && (r.json?.items || []).length === 0,
        JSON.stringify(r.json))

  r = await call('POST', `/social/mamm-pamm/${made.master._id}/invest?amount=500&account_id=${acct}`)
  check('invest 200', r.status === 200, JSON.stringify(r.json))
  const follower = await CopyFollower.findOne({ followerId: made.user._id })
  check('a copy subscription exists at that size',
        !!follower && follower.copyValue === 500 && follower.status === 'ACTIVE',
        JSON.stringify(follower && { v: follower.copyValue, s: follower.status }))

  r = await call('GET', '/social/my-allocations')
  check('it shows up in allocations', (r.json?.items || []).length === 1, JSON.stringify(r.json?.items))
  check('summary totals add up', r.json?.summary?.total_invested === 500, JSON.stringify(r.json?.summary))

  r = await call('POST', `/social/mamm-pamm/${made.master._id}/invest?amount=800&account_id=${acct}`)
  const again = await CopyFollower.find({ followerId: made.user._id, status: { $in: ['ACTIVE', 'PAUSED'] } })
  check('investing twice resizes, not duplicates', again.length === 1 && again[0].copyValue === 800,
        JSON.stringify(again.map(a => a.copyValue)))

  r = await call('DELETE', `/social/mamm-pamm/${made.master._id}/withdraw`)
  check('withdraw 200', r.status === 200, JSON.stringify(r.json))
  const stopped = await CopyFollower.findOne({ followerId: made.user._id })
  check('subscription is stopped', stopped?.status === 'STOPPED', stopped?.status)
  r = await call('GET', '/social/my-allocations')
  check('and gone from allocations', (r.json?.items || []).length === 0, JSON.stringify(r.json?.items))

  r = await call('GET', '/social/masters/eligibility')
  check('eligibility 200', r.status === 200 && r.json?.is_master === false, JSON.stringify(r.json))
  r = await call('GET', '/social/master-performance')
  check('not a manager -> is_master false', r.json?.is_master === false, JSON.stringify(r.json))
  r = await call('GET', '/social/master-investors')
  check('no investors to list', Array.isArray(r.json?.items), JSON.stringify(r.json))
  r = await call('GET', '/social/follow-requests')
  check('follow requests answer empty, not 404', r.status === 200 && Array.isArray(r.json?.items),
        String(r.status))

  console.log('\n7) notifications and banners answer empty rather than 404\n')
  for (const p of ['/notifications', '/banners']) {
    r = await call('GET', p)
    check(`${p} 200`, r.status === 200 && Array.isArray(r.json?.items), String(r.status))
  }

  console.log('\n8) somebody else cannot read this account\n')
  const stranger = jwt.sign({ id: String(new mongoose.Types.ObjectId()), typ: 'terminal' },
                            process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '15m' })
  const saved = TOKEN; TOKEN = stranger
  r = await call('GET', `/accounts/${acct}/summary`)
  check('never 200', r.status !== 200, String(r.status))
  r = await call('GET', `/portfolio/summary?account_id=${acct}`)
  check('portfolio never 200', r.status !== 200, String(r.status))
  TOKEN = saved
} finally {
  if (made.user) {
    await CopyFollower.deleteMany({ followerId: made.user._id })
    await Trade.deleteMany({ userId: made.user._id })
    await TradingAccount.deleteMany({ userId: made.user._id })
    await User.deleteOne({ _id: made.user._id })
  }
  if (made.masterUser) {
    await MasterTrader.deleteMany({ userId: made.masterUser._id })
    await TradingAccount.deleteMany({ userId: made.masterUser._id })
    await User.deleteOne({ _id: made.masterUser._id })
  }
  if (made.type) await AccountType.deleteOne({ _id: made.type._id })
  console.log('\ntest rows removed')
  await mongoose.disconnect()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
