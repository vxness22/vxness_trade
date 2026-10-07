// Do the web terminal and the desktop terminal agree, and does every desktop
// feature actually work? END-TO-END, against a running server.
//
//   1. node scripts/testTerminalSync.mjs seed          (before the server starts)
//   2. start the server against the same database, feed off:
//        PORT=5099 MONGODB_URI=mongodb://127.0.0.1:27017/vxness_sync_e2e \
//        INFOWAY_API_KEY= BINANCE_FEED=off JWT_SECRET=sync-e2e node server.js
//   3. node scripts/testTerminalSync.mjs run
//
// The feed is off on purpose: the server then prices from data/lastPrices.json,
// which is frozen, so "the same order at the same moment" is reproducible. It
// also means this never opens a connection on the production Infoway key.
// Isolated database — never touches vxness_local or production.

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/vxness_sync_e2e'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sync-e2e'

import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import WebSocket from 'ws'
import User from '../models/User.js'
import AccountType from '../models/AccountType.js'
import TradingAccount from '../models/TradingAccount.js'
import Trade from '../models/Trade.js'
import Charges from '../models/Charges.js'
import SharedTrade from '../models/SharedTrade.js'

const API = process.env.SYNC_API || 'http://127.0.0.1:5099'
const EMAIL = 'sync-e2e@test.local'
const PASSWORD = 'pass1234'
const SYM = 'EURUSD'

let pass = 0, fail = 0
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${label}`) }
  else { fail++; console.log(`FAIL  ${label}${detail ? '  -> ' + detail : ''}`) }
}

async function http(method, path, { token, account, body, key } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (account) headers['X-Account-Id'] = account
  if (key) { headers['X-Api-Key'] = key.api_key; headers['X-Api-Secret'] = key.api_secret }
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await r.json() } catch { /* empty */ }
  return { status: r.status, data }
}

const holdBack = (id) => Trade.updateOne({ _id: id }, { $set: { openedAt: new Date(Date.now() - 10 * 60 * 1000) } })
const balanceOf = async (id) => (await TradingAccount.findById(id)).balance
const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI)
  await mongoose.connection.dropDatabase()
  const type = await AccountType.create({ name: 'Standard', minDeposit: 10, leverage: '1:100', isActive: true })
  const user = await User.create({ firstName: 'Sync', email: EMAIL, phone: '0000000000', password: PASSWORD, kycApproved: true })
  for (const n of [1, 2]) {
    await TradingAccount.create({
      userId: user._id, accountTypeId: type._id, accountId: await TradingAccount.generateAccountId(),
      balance: 10000, credit: 0, leverage: '1:100', status: 'Active',
    })
  }
  // One spread and one commission for everything: 2 points, $5/lot, charged on close too.
  await Charges.create({
    level: 'GLOBAL', isActive: true,
    spreadType: 'FIXED', spreadValue: 2,
    commissionType: 'PER_LOT', commissionValue: 5,
    commissionOnBuy: true, commissionOnSell: true, commissionOnClose: true,
  })
  console.log('seeded', mongoose.connection.name)
  await mongoose.disconnect()
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI)
  const user = await User.findOne({ email: EMAIL })
  const [A, B] = await TradingAccount.find({ userId: user._id }).sort({ createdAt: 1 })
  const a = String(A._id), b = String(B._id)

  // ---- sign-in, as the desktop does it ----
  const login = await http('POST', '/api/v1/auth/login', { body: { email: EMAIL, password: PASSWORD } })
  const token = login.data?.access_token || login.data?.token
  ok(login.status === 200 && token, 'desktop sign-in returns a session', JSON.stringify(login.data))
  const list = await http('GET', '/api/v1/accounts', { token })
  const ids = (list.data?.items || []).map(x => x.account_id)
  ok(ids.includes(a) && ids.includes(b), 'account list carries both accounts')

  // ---- account switching: orders go to the account on screen ----
  const algoB = await http('POST', '/api/algo/trade', { token, account: b, body: { action: 'BUY', symbol: SYM, volume: 0.1, comment: 'terminal' } })
  const tB = algoB.data?.position_id ? await Trade.findById(algoB.data.position_id) : null
  ok(algoB.status === 200 && tB && String(tB.tradingAccountId) === b,
     'desktop order with account B selected lands on account B', JSON.stringify(algoB.data))
  ok(tB?.comment === 'terminal', 'desktop order comment is stored')
  const acctA = await http('GET', '/api/algo/account', { token, account: a })
  const acctB = await http('GET', '/api/algo/account', { token, account: b })
  ok(acctA.status === 200 && acctB.status === 200 && acctA.data.account === A.accountId && acctB.data.account === B.accountId,
     'balance/margin line follows the selected account')

  // A key minted for A must keep working for API-key mode, and only for A.
  const key = (await http('POST', '/api/v1/algo/generate', { token, body: { account_id: a, label: 'e2e' } })).data
  const viaKey = await http('GET', '/api/algo/account', { key })
  ok(viaKey.status === 200 && viaKey.data.account === A.accountId, 'API-key mode still reaches its own account')

  // ---- investor sessions are read-only on /api/algo too ----
  const investor = jwt.sign({ id: String(user._id), typ: 'terminal', ro: true, acct: a }, process.env.JWT_SECRET, { expiresIn: '5m' })
  const invTrade = await http('POST', '/api/algo/trade', { token: investor, account: a, body: { action: 'BUY', symbol: SYM, volume: 0.1 } })
  ok(invTrade.status === 403, 'investor token cannot trade through /api/algo', `${invTrade.status}`)
  const invOther = await http('GET', '/api/algo/account', { token: investor, account: b })
  ok(invOther.status === 403, 'investor token cannot read another account', `${invOther.status}`)

  // ---- web vs desktop: same order, same moment, same fill ----
  const web = await http('POST', '/api/trade/open', {
    token, body: { tradingAccountId: a, symbol: SYM, side: 'BUY', orderType: 'MARKET', quantity: 0.1, bid: 0.5, ask: 0.5 },
  })
  const tA = web.data?.trade
  ok(web.status === 200 && tA, 'web order opens', JSON.stringify(web.data))
  ok(tA && tA.openPrice > 1, 'web fill ignores a client-supplied price (sent 0.5)', `${tA?.openPrice}`)
  ok(tA && tB && near(tA.openPrice, tB.openPrice), 'web and desktop fill the same order at the same price',
     `${tA?.openPrice} vs ${tB?.openPrice}`)
  ok(tA && tB && near(tA.commission, tB.commission), 'web and desktop charge the same commission')

  // ---- desktop pending orders go through the engine ----
  const q = (await http('GET', '/api/algo/prices?symbols=' + SYM, { token, account: a })).data.prices[0]
  const pend = await http('POST', '/api/v1/orders', {
    token, body: { account_id: a, symbol: SYM, side: 'buy', order_type: 'limit', lots: 0.1, price: +(q.bid - 0.01).toFixed(5), comment: 'dip' },
  })
  const pendDoc = pend.data?.id ? await Trade.findById(pend.data.id) : null
  ok(pend.status === 200 && pendDoc?.status === 'PENDING', 'desktop pending order is placed', JSON.stringify(pend.data))
  ok(pendDoc && pendDoc.commission > 0, 'desktop pending order carries commission like the web', `${pendDoc?.commission}`)
  ok(pendDoc?.comment === 'dip', 'pending order comment is stored')
  const huge = await http('POST', '/api/v1/orders', {
    token, body: { account_id: a, symbol: SYM, side: 'buy', order_type: 'limit', lots: 90, price: +(q.bid - 0.01).toFixed(5) },
  })
  ok(huge.status === 400, 'desktop pending order is margin-checked', `${huge.status} ${JSON.stringify(huge.data)}`)
  const badEdit = await http('PUT', `/api/v1/orders/${pend.data.id}`, { token, body: { price: +(q.ask + 0.01).toFixed(5) } })
  ok(badEdit.status === 400, 'editing a buy limit above the market is refused', `${badEdit.status}`)
  const badBracket = await http('PUT', `/api/v1/orders/${pend.data.id}`, { token, body: { stop_loss: +(q.bid + 0.005).toFixed(5) } })
  ok(badBracket.status === 400, 'editing in a wrong-side stop is refused', `${badBracket.status}`)

  // ---- a pending fill is atomic and pays its commission once ----
  const engine = (await import('../services/tradeEngine.js')).default
  await Trade.updateOne({ _id: pendDoc._id }, { $set: { pendingPrice: q.ask + 1, openPrice: q.ask + 1 } })
  const before = await balanceOf(a)
  const prices = { [SYM]: { bid: q.bid, ask: q.ask } }
  const fills = await Promise.all([engine.checkPendingOrders(prices), engine.checkPendingOrders(prices)])
  const filled = await Trade.findById(pendDoc._id)
  ok(filled.status === 'OPEN' && fills.flat().length === 1, 'two concurrent sweeps fill the order once', `${fills.flat().length}`)
  ok(near(before - (await balanceOf(a)), pendDoc.commission, 1e-6), 'the fill deducts the commission exactly once',
     `${before - (await balanceOf(a))} vs ${pendDoc.commission}`)

  // ---- partial close through the engine ----
  await holdBack(tA._id)
  const offGrid = await http('POST', `/api/v1/positions/${tA._id}/close`, { token, body: { lots: 0.033 } })
  ok(offGrid.status === 400, 'a partial close off the 0.01 lot step is refused', `${offGrid.status}`)
  const balPre = await balanceOf(a)
  const part = await http('POST', `/api/v1/positions/${tA._id}/close`, { token, body: { lots: 0.04 } })
  const parent = await Trade.findById(tA._id)
  const slice = await Trade.findOne({ tradingAccountId: A._id, status: 'CLOSED', quantity: 0.04 })
  ok(part.status === 200 && near(parent.quantity, 0.06), 'partial close leaves the remainder open', JSON.stringify(part.data))
  ok(slice && near((await balanceOf(a)) - balPre, slice.realizedPnl, 1e-6), 'partial close moves the balance by exactly the slice P&L')
  const raw = engine.calculatePnl(slice.side, slice.openPrice, slice.closePrice, slice.quantity, slice.contractSize, slice.symbol)
  ok(slice && raw - slice.realizedPnl > 0.19, 'partial close pays commission-on-close (5/lot x 0.04 = 0.20)',
     `raw ${raw} realized ${slice?.realizedPnl}`)

  // ---- a close is claimed once ----
  await holdBack(tB._id)
  const balB = await balanceOf(b)
  const [c1, c2] = await Promise.all([
    http('POST', `/api/v1/positions/${tB._id}/close`, { token, body: {} }),
    http('POST', `/api/v1/positions/${tB._id}/close`, { token, body: {} }),
  ])
  const closedB = await Trade.findById(tB._id)
  ok([c1.status, c2.status].filter(s => s === 200).length === 1, 'two simultaneous closes: exactly one succeeds',
     `${c1.status}/${c2.status}`)
  ok(near((await balanceOf(b)) - balB, closedB.realizedPnl, 1e-6), 'and the P&L is credited once')

  // ---- comments, history, spec, share ----
  const cm = await http('PUT', `/api/v1/positions/${tA._id}`, { token, body: { comment: 'swing' } })
  const pos = (await http('GET', `/api/v1/positions?account_id=${a}`, { token })).data || []
  ok(cm.status === 200 && pos.find(p => p.id === String(tA._id))?.comment === 'swing', 'editing a position comment works')
  ok(pos[0] && pos[0].mark_bid > 0 && pos[0].quote_to_usd > 0, 'positions carry mark_bid and quote_to_usd for the chart overlay')

  const hist = (await http('GET', `/api/v1/portfolio/trades?account_id=${b}&per_page=1000`, { token })).data
  const h0 = hist?.items?.[0]
  ok(h0 && 'stop_loss' in h0 && 'take_profit' in h0 && 'comment' in h0, 'history rows carry S/L, T/P and comment')

  const spec = await http('GET', `/api/v1/trading/instruments/${SYM}?account_id=${a}`, { token })
  ok(spec.status === 200 && spec.data.spread?.value === 2 && spec.data.commission_preview_per_lot === 5,
     'symbol specification states the account\'s spread and commission', JSON.stringify(spec.data))

  const sh = await http('POST', `/api/v1/positions/${tA._id}/share`, { token, body: { description: 'my trade', display_mode: 'roi' } })
  const pub = await http('GET', `/api/v1/share/${sh.data?.short_code}`)
  ok(sh.status === 200 && pub.status === 200 && pub.data.symbol === SYM && pub.data.display_mode === 'roi',
     'share link is created and publicly readable', JSON.stringify(pub.data))
  ok(!JSON.stringify(pub.data).includes(EMAIL) && !JSON.stringify(pub.data).includes(A.accountId),
     'a shared trade exposes no email or account number')
  const sh2 = await http('POST', `/api/v1/positions/${tA._id}/share`, { token, body: { display_mode: 'pnl' } })
  ok(sh2.data?.short_code === sh.data?.short_code, 're-sharing the same trade keeps its link')

  // ---- instruments: only what the feed delivers, one digits table ----
  const syms = (await http('GET', '/api/algo/symbols', { token, account: a })).data?.symbols || []
  const webSyms = (await http('GET', '/api/v1/instruments', { token })).data?.items || []
  ok(syms.length > 0 && syms.length === webSyms.length, 'desktop and app/web list the same instruments',
     `${syms.length} vs ${webSyms.length}`)
  const doge = syms.find(s => s.symbol === 'DOGEUSD')
  ok(!doge || doge.digits >= 5, 'DOGE is shown with enough decimals', `${doge?.digits}`)
  const xag = syms.find(s => s.symbol === 'XAGUSD')
  ok(!xag || xag.contract_size === 5000, 'silver contract size matches the engine (5000)', `${xag?.contract_size}`)

  // ---- price socket: quotes for the selected account, with the raw mid ----
  const wsRes = await new Promise((resolve) => {
    const ws = new WebSocket(API.replace('http', 'ws') + '/ws/algo/prices')
    const out = { auth: null, tick: null }
    const done = () => { try { ws.close() } catch {} resolve(out) }
    setTimeout(done, 5000)
    ws.on('open', () => ws.send(JSON.stringify({ action: 'auth', token, account_id: b })))
    ws.on('message', (m) => {
      const o = JSON.parse(m.toString())
      if (o.status) out.auth = o
      if (o.type === 'tick' && o.symbol === SYM) { out.tick = o; done() }
    })
  })
  ok(wsRes.auth?.status === 'authenticated' && wsRes.auth.account === B.accountId,
     'price socket authenticates for the account on screen', JSON.stringify(wsRes.auth))
  ok(wsRes.tick && wsRes.tick.mid > 0 && wsRes.tick.ask - wsRes.tick.bid > 0, 'ticks carry the raw mid next to the account quote')

  // ---- sign-up and open account, as the desktop sends them ----
  const signupEmail = `new${Date.now()}@test.local`
  const su = await http('POST', '/api/v1/auth/register/start', {
    body: { email: signupEmail, password: 'pass1234', first_name: 'Ann', last_name: 'Lee', phone: '1', country: 'IN' },
  })
  ok(su.status === 200 && su.data.otp_required === false && su.data.access_token, 'sign-up with email codes off returns a session',
     JSON.stringify(su.data))
  ok((await User.findOne({ email: signupEmail }))?.firstName === 'Ann Lee', 'sign-up keeps the surname')
  const groups = (await http('GET', '/api/v1/accounts/available-groups', { token })).data?.items || []
  ok(groups[0]?.max_leverage === 100 && groups[0]?.minimum_deposit === 10, 'account types carry leverage and minimum deposit')
  const opened = await http('POST', '/api/v1/accounts/open', { token, body: { account_group_id: groups[0].id, leverage: 5000 } })
  ok(opened.status === 200 && opened.data.leverage === '1:100', 'opening an account caps leverage at the type maximum',
     JSON.stringify(opened.data))

  console.log(`\n${pass} passed, ${fail} failed`)
  await mongoose.disconnect()
  process.exit(fail ? 1 : 0)
}

const mode = process.argv[2]
if (mode === 'seed') await seed()
else if (mode === 'run') await run()
else { console.log('usage: node scripts/testTerminalSync.mjs seed|run'); process.exit(2) }
