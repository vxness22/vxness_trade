// Every way a trade is opened, managed and closed — on every client.
//
//   1. node scripts/testTradingFlows.mjs seed
//   2. PORT=5099 MONGODB_URI=mongodb://127.0.0.1:27017/vxness_flows_e2e \
//      INFOWAY_API_KEY= BINANCE_FEED=off JWT_SECRET=flows-e2e node server.js
//   3. node scripts/testTradingFlows.mjs run
//
// The three clients are driven exactly as they call the server:
//   web     /api/trade/*            (website terminal)
//   desktop /api/algo/* + /api/v1/* (desktop terminal)
//   app     /api/v1/*               (mobile app)
// Expected fills, P&L, commission and balances are computed HERE, independently
// of the engine, from the same frozen quotes the server prices from
// (data/lastPrices.json — the feed is off, so they do not move).
// Sweeps that need the market to move (SL/TP, pending fills, stop-out) are run
// in-process against the same database with a moved price map.
// Isolated database; nothing here touches vxness_local or production.

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/vxness_flows_e2e'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'flows-e2e'

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import User from '../models/User.js'
import AccountType from '../models/AccountType.js'
import TradingAccount from '../models/TradingAccount.js'
import Trade from '../models/Trade.js'
import Charges from '../models/Charges.js'
import MasterTrader from '../models/MasterTrader.js'
import CopyFollower from '../models/CopyFollower.js'
import CopyTrade from '../models/CopyTrade.js'

const API = process.env.FLOWS_API || 'http://127.0.0.1:5099'
const here = path.dirname(fileURLToPath(import.meta.url))
const RAW = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'lastPrices.json'), 'utf8')).prices

const MAP_FILE = path.join(os.tmpdir(), 'vxness-flows-e2e.json')   // account name -> _id
const PASSWORD = 'pass1234'
const START = 10000
const SPREAD_POINTS = 2
const COMM_PER_LOT = 5

let pass = 0, fail = 0
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${label}`) }
  else { fail++; console.log(`FAIL  ${label}${detail !== '' ? '  -> ' + detail : ''}`) }
  return !!cond
}
const near = (a, b, eps = 0.011) => Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) <= eps
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ── independent instrument facts ───────────────────────────────────────── */
const CRYPTO = new Set(['BTCUSD', 'ETHUSD'])
const META = {
  EURUSD: { pip: 0.00001, cs: 100000, lots: 0.1 },
  USDJPY: { pip: 0.001, cs: 100000, lots: 0.1 },
  XAUUSD: { pip: 0.01, cs: 100, lots: 0.1 },
  USOIL:  { pip: 0.01, cs: 1000, lots: 0.1 },
  US30:   { pip: 1, cs: 1, lots: 0.5 },
  BTCUSD: { pip: 0.01, cs: 1, lots: 0.05 },
}
const SYMBOLS = Object.keys(META).filter(s => RAW[s])

function expectedOpen(sym, side) {
  const d = SPREAD_POINTS * META[sym].pip
  return side === 'BUY' ? RAW[sym].ask + d : RAW[sym].bid - d
}
function expectedPnl(sym, side, open, close, lots) {
  const raw = (side === 'BUY' ? close - open : open - close) * lots * META[sym].cs
  if (sym.length === 6 && !CRYPTO.has(sym) && !sym.startsWith('X') && sym !== 'USOIL') {
    const base = sym.slice(0, 3), quote = sym.slice(3)
    if (quote === 'USD') return raw
    if (base === 'USD') return raw / close
  }
  return raw
}
// The engine's documented rule (utils/commissionMath.js): commission is entered
// in the same POINTS unit as the spread, so a per-lot charge is
// value x point x contract x lots, converted from the quote currency to USD.
const pipOf = (s) => META[s]?.pip ?? (s.includes('JPY') ? 0.001 : 0.00001)
const csOf = (s) => META[s]?.cs ?? 100000
function q2u(s, price) {
  if (s.length !== 6 || CRYPTO.has(s) || s.startsWith('X')) return 1
  const base = s.slice(0, 3), quote = s.slice(3)
  if (quote === 'USD') return 1
  if (base === 'USD') return 1 / price
  const d = RAW[quote + 'USD']
  if (d) return (d.bid + d.ask) / 2
  const inv = RAW['USD' + quote]
  return 2 / (inv.bid + inv.ask)
}
const commission = (sym, lots, price) => COMM_PER_LOT * pipOf(sym) * csOf(sym) * lots * q2u(sym, price)

/* ── HTTP, as each client sends it ──────────────────────────────────────── */
async function http(method, p, { token, account, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (account) headers['X-Account-Id'] = account
  const r = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await r.json() } catch { /* empty */ }
  return { status: r.status, data }
}

// Open a market order through one client; returns the Trade document.
async function openVia(client, token, accountId, sym, side, lots, extra = {}) {
  let r, id
  if (client === 'web') {
    r = await http('POST', '/api/trade/open', { token, body: {
      tradingAccountId: accountId, symbol: sym, side, orderType: 'MARKET', quantity: lots,
      sl: extra.sl, tp: extra.tp } })
    id = r.data?.trade?._id
  } else if (client === 'desktop') {
    r = await http('POST', '/api/algo/trade', { token, account: accountId, body: {
      action: side, symbol: sym, volume: lots, sl: extra.sl, tp: extra.tp } })
    id = r.data?.position_id
  } else {
    r = await http('POST', '/api/v1/orders', { token, body: {
      account_id: accountId, symbol: sym, side: side.toLowerCase(), order_type: 'market', lots,
      stop_loss: extra.sl, take_profit: extra.tp } })
    id = r.data?.id
  }
  return { r, trade: id ? await Trade.findById(id) : null }
}

// Close through one client.
async function closeVia(client, token, trade, lots = null) {
  if (client === 'web') return http('POST', '/api/trade/close', { token, body: { tradeId: String(trade._id) } })
  if (client === 'desktop-all') {
    return http('POST', '/api/algo/trade', { token, account: String(trade.tradingAccountId),
      body: { action: 'CLOSE', symbol: trade.symbol } })
  }
  return http('POST', `/api/v1/positions/${trade._id}/close`, { token, body: lots ? { lots } : {} })
}

const holdBack = (id) => Trade.updateOne({ _id: id }, { $set: { openedAt: new Date(Date.now() - 10 * 60 * 1000) } })
const balanceOf = async (id) => (await TradingAccount.findById(id)).balance
const login = async (email) => (await http('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } })).data?.access_token

// Raw quotes with one symbol's bid/ask moved — what a sweep sees.
function pricesWith(sym, bid, ask) {
  const m = {}
  for (const [s, p] of Object.entries(RAW)) m[s] = { bid: p.bid, ask: p.ask }
  m[sym] = { bid, ask }
  return m
}

/* ── seed ───────────────────────────────────────────────────────────────── */
async function seed() {
  await mongoose.connect(process.env.MONGODB_URI)
  await mongoose.connection.dropDatabase()
  const type = await AccountType.create({ name: 'Standard', minDeposit: 10, leverage: '1:100', isActive: true })
  const mk = (email, kyc) => User.create({ firstName: email.split('@')[0], email, phone: '0', password: PASSWORD, kycApproved: kyc })
  const trader = await mk('trader@flows.local', true)
  const nokyc = await mk('nokyc@flows.local', false)
  const follower = await mk('follower@flows.local', true)
  const names = {}
  const acct = async (user, name, balance = START, status = 'Active') => {
    const a = await TradingAccount.create({
      userId: user._id, accountTypeId: type._id, accountId: await TradingAccount.generateAccountId(),
      balance, credit: 0, leverage: '1:100', status,
    })
    names[name] = String(a._id)
    return a
  }
  const W = await acct(trader, 'web'), D = await acct(trader, 'desktop'), P = await acct(trader, 'app')
  await acct(trader, 'small', 300)
  await acct(trader, 'suspended', START, 'Suspended')
  const M = await acct(trader, 'master')
  await acct(nokyc, 'nokyc')
  const F = await acct(follower, 'follower')
  await Charges.create({
    level: 'GLOBAL', isActive: true, spreadType: 'FIXED', spreadValue: SPREAD_POINTS,
    commissionType: 'PER_LOT', commissionValue: COMM_PER_LOT,
    commissionOnBuy: true, commissionOnSell: true, commissionOnClose: true,
  })
  const master = await MasterTrader.create({
    userId: trader._id, tradingAccountId: M._id, displayName: 'Master', requestedCommissionPercentage: 10, status: 'ACTIVE',
  })
  await CopyFollower.create({
    followerId: follower._id, masterId: master._id, followerAccountId: F._id,
    copyMode: 'FIXED_LOT', copyValue: 0.2, status: 'ACTIVE',
  })
  fs.writeFileSync(MAP_FILE, JSON.stringify(names))
  console.log('seeded', mongoose.connection.name, W.accountId, D.accountId, P.accountId)
  await mongoose.disconnect()
}

/* ── run ────────────────────────────────────────────────────────────────── */
async function run() {
  await mongoose.connect(process.env.MONGODB_URI)
  const engine = (await import('../services/tradeEngine.js')).default
  const trader = await User.findOne({ email: 'trader@flows.local' })
  const names = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'))
  const id = (n) => names[n]
  const token = await login('trader@flows.local')
  const tokenNoKyc = await login('nokyc@flows.local')
  const nokycAcct = id('nokyc')
  const F = await TradingAccount.findById(id('follower'))
  ok(token && tokenNoKyc, 'both users sign in')

  /* 1. BUY and SELL on every asset class, through every client, closed through another */
  console.log('\n── market orders: every symbol × every client ──')
  const openers = ['web', 'desktop', 'app']
  const closers = { web: 'v1', desktop: 'web', app: 'desktop-all' }
  const accountFor = { web: 'web', desktop: 'desktop', app: 'app' }
  for (const sym of SYMBOLS) {
    for (const [i, client] of openers.entries()) {
      const side = i % 2 === 0 ? 'BUY' : 'SELL'
      const lots = META[sym].lots
      const acc = id(accountFor[client])
      const bal0 = await balanceOf(acc)
      const { r, trade } = await openVia(client, token, acc, sym, side, lots)
      const tag = `${sym} ${side} via ${client}`
      if (!ok(r.status === 200 && trade, `${tag}: opens`, `${r.status} ${JSON.stringify(r.data)}`)) continue
      ok(near(trade.openPrice, expectedOpen(sym, side), META[sym].pip / 2),
         `${tag}: fills at quote ± admin spread`, `${trade.openPrice} vs ${expectedOpen(sym, side)}`)
      ok(near(trade.commission, commission(sym, lots, trade.openPrice)), `${tag}: open commission`, `${trade.commission} vs ${commission(sym, lots, trade.openPrice)}`)
      ok(near(bal0 - await balanceOf(acc), trade.commission), `${tag}: balance pays the open commission`)

      // too early to close: the 3-minute hold, on every close path
      const early = await closeVia(closers[client], token, trade)
      const stillOpen = (await Trade.findById(trade._id)).status === 'OPEN'
      ok(early.status >= 400 && stillOpen, `${tag}: refused to close inside 3 minutes (${closers[client]})`, early.status)

      await holdBack(trade._id)
      const bal1 = await balanceOf(acc)
      const c = await closeVia(closers[client], token, trade)
      const closed = await Trade.findById(trade._id)
      ok(c.status === 200 && closed.status === 'CLOSED', `${tag}: closes via ${closers[client]}`, `${c.status} ${JSON.stringify(c.data)}`)
      const closeAt = side === 'BUY' ? RAW[sym].bid : RAW[sym].ask
      ok(near(closed.closePrice, closeAt, META[sym].pip / 2), `${tag}: closes at the market (${side === 'BUY' ? 'bid' : 'ask'})`)
      const want = expectedPnl(sym, side, closed.openPrice, closeAt, lots) - commission(sym, lots, closeAt)
      ok(near(closed.realizedPnl, want), `${tag}: realized P&L = price move − close commission`,
         `${closed.realizedPnl} vs ${want}`)
      ok(near(await balanceOf(acc) - bal1, closed.realizedPnl), `${tag}: balance moves by exactly the realized P&L`)
    }
  }

  /* 2. SL / TP on every client */
  console.log('\n── SL / TP ──')
  const sym = 'EURUSD'
  const q = RAW[sym]
  for (const client of openers) {
    const acc = id(accountFor[client])
    const bad = await openVia(client, token, acc, sym, 'BUY', 0.1, { sl: +(q.bid + 0.002).toFixed(5) })
    ok(bad.r.status === 400 && !bad.trade, `${client}: BUY with a stop above the market is refused`, bad.r.status)
    const badTp = await openVia(client, token, acc, sym, 'SELL', 0.1, { tp: +(q.ask + 0.002).toFixed(5) })
    ok(badTp.r.status === 400, `${client}: SELL with a target above the market is refused`, badTp.r.status)

    const sl = +(q.bid - 0.002).toFixed(5), tp = +(q.ask + 0.003).toFixed(5)
    const { r, trade } = await openVia(client, token, acc, sym, 'BUY', 0.1, { sl, tp })
    ok(r.status === 200 && near(trade?.sl ?? trade?.stopLoss, sl, 1e-9) && near(trade?.tp ?? trade?.takeProfit, tp, 1e-9),
       `${client}: BUY opens carrying its SL and TP`, JSON.stringify({ sl: trade?.sl, tp: trade?.tp }))
    if (!trade) continue

    // edit both ways: web modify and v1 modify; then remove
    const sl2 = +(q.bid - 0.0025).toFixed(5)
    const m1 = await http('PUT', '/api/trade/modify', { token, body: { tradeId: String(trade._id), sl: sl2 } })
    ok(m1.status === 200 && near((await Trade.findById(trade._id)).sl, sl2, 1e-9), `${client} trade: web modifies the stop`)
    const tp2 = +(q.ask + 0.004).toFixed(5)
    const m2 = await http('PUT', `/api/v1/positions/${trade._id}`, { token, body: { take_profit: tp2 } })
    const t2 = await Trade.findById(trade._id)
    ok(m2.status === 200 && near(t2.tp, tp2, 1e-9) && near(t2.sl, sl2, 1e-9), `${client} trade: desktop modifies the target, stop untouched`)
    const wrong = await http('PUT', `/api/v1/positions/${trade._id}`, { token, body: { stop_loss: +(q.bid + 0.001).toFixed(5) } })
    ok(wrong.status === 400, `${client} trade: moving the stop through the market is refused`, wrong.status)

    // SL fires only after the 3-minute hold, and closes at the stop
    let hit = await engine.checkSlTpForAllTrades(pricesWith(sym, sl2 - 0.0001, sl2 - 0.0001 + (q.ask - q.bid)))
    ok(!hit.some(h => String(h.trade._id) === String(trade._id)), `${client} trade: SL does not fire inside 3 minutes`)
    await holdBack(trade._id)
    const bal1 = await balanceOf(acc)
    hit = await engine.checkSlTpForAllTrades(pricesWith(sym, sl2 - 0.0001, sl2 - 0.0001 + (q.ask - q.bid)))
    const closed = await Trade.findById(trade._id)
    ok(closed.status === 'CLOSED' && closed.closedBy === 'SL' && near(closed.closePrice, sl2, 1e-9),
       `${client} trade: SL fires and closes at the stop price`, `${closed.status} ${closed.closedBy} ${closed.closePrice}`)
    const want = expectedPnl(sym, 'BUY', closed.openPrice, sl2, 0.1) - commission(sym, 0.1, sl2)
    ok(near(closed.realizedPnl, want), `${client} trade: SL loss is the stop distance − close commission`, `${closed.realizedPnl} vs ${want}`)
    ok(near(await balanceOf(acc) - bal1, closed.realizedPnl), `${client} trade: SL debits exactly that`)
  }
  // TP on a SELL, and brackets removed
  {
    const acc = id('web')
    const tp = +(q.ask - 0.003).toFixed(5)
    const { trade } = await openVia('web', token, acc, sym, 'SELL', 0.1, { tp, sl: +(q.ask + 0.003).toFixed(5) })
    const rm = await http('PUT', `/api/v1/positions/${trade._id}`, { token, body: { stop_loss: null } })
    const t = await Trade.findById(trade._id)
    ok(rm.status === 200 && !t.sl && !t.stopLoss && near(t.tp ?? t.takeProfit, tp, 1e-9), 'a stop can be removed, leaving the target',
       JSON.stringify({ status: rm.status, body: rm.data?.detail, sl: t.sl, stopLoss: t.stopLoss, tp: t.tp, takeProfit: t.takeProfit, want: tp }))
    await holdBack(trade._id)
    const hit = await engine.checkSlTpForAllTrades(pricesWith(sym, tp - 0.0002 - (q.ask - q.bid), tp - 0.0002))
    const closed = await Trade.findById(trade._id)
    ok(closed.status === 'CLOSED' && closed.closedBy === 'TP' && near(closed.closePrice, tp, 1e-9), 'SELL take-profit fires at the target')
    ok(near(closed.realizedPnl, expectedPnl(sym, 'SELL', closed.openPrice, tp, 0.1) - commission(sym, 0.1, tp)), 'SELL take-profit pays the right amount')
    ok(hit.length >= 1, 'the sweep reports the TP')
  }

  /* 3. Pending orders: four types × web and desktop; edit; cancel; fill */
  console.log('\n── pending orders ──')
  // Each order on its own symbol: the fill sweep looks at every resting order,
  // so moving one market must not also trigger another order under test.
  const PEND = [
    ['BUY', 'LIMIT', 'web', 'EURUSD'], ['BUY', 'LIMIT', 'desktop', 'GBPUSD'],
    ['BUY', 'STOP', 'web', 'AUDUSD'],  ['BUY', 'STOP', 'desktop', 'NZDUSD'],
    ['SELL', 'LIMIT', 'web', 'USDCAD'], ['SELL', 'LIMIT', 'desktop', 'USDCHF'],
    ['SELL', 'STOP', 'web', 'EURGBP'], ['SELL', 'STOP', 'desktop', 'EURCHF'],
  ].filter(x => RAW[x[3]])
  const placed = []
  for (const [side, kind, client, ps] of PEND) {
    const pq = RAW[ps]
    const away = 0.003
    const good = side === 'BUY'
      ? +(kind === 'LIMIT' ? pq.ask - away : pq.ask + away).toFixed(5)
      : +(kind === 'LIMIT' ? pq.bid + away : pq.bid - away).toFixed(5)
    const wrongSide = side === 'BUY'
      ? +(kind === 'LIMIT' ? pq.ask + away : pq.ask - away).toFixed(5)
      : +(kind === 'LIMIT' ? pq.bid - away : pq.bid + away).toFixed(5)
    const acc = id(client === 'web' ? 'web' : 'desktop')
    const place = (price) => client === 'web'
      ? http('POST', '/api/trade/open', { token, body: { tradingAccountId: acc, symbol: ps, side, orderType: `${side}_${kind}`, quantity: 0.1, price } })
      : http('POST', '/api/v1/orders', { token, body: { account_id: acc, symbol: ps, side: side.toLowerCase(), order_type: kind.toLowerCase(), lots: 0.1, price } })
    const tag = `${side} ${kind} ${ps} via ${client}`
    const w = await place(wrongSide)
    ok(w.status === 400, `${tag}: on the wrong side of the market is refused`, w.status)
    const g = await place(good)
    const oid = g.data?.trade?._id || g.data?.id
    const doc = oid ? await Trade.findById(oid) : null
    ok(g.status === 200 && doc?.status === 'PENDING' && near(doc.pendingPrice, good, 1e-9),
       `${tag}: rests at the requested price`, `${g.status} ${JSON.stringify(g.data)}`)
    ok(doc && near(doc.commission, commission(ps, 0.1, good)) && doc.marginUsed > 0, `${tag}: margin reserved and commission recorded`)
    if (doc) placed.push({ doc, side, kind, client, acc, good, sym: ps })
  }
  // edit through both clients
  {
    const a = placed.find(p => p.side === 'BUY' && p.kind === 'LIMIT' && p.client === 'web')
    const b = placed.find(p => p.side === 'SELL' && p.kind === 'LIMIT' && p.client === 'desktop')
    const np = +(RAW[a.sym].ask - 0.004).toFixed(5)
    const e1 = await http('PUT', `/api/trade/pending/${a.doc._id}`, { token, body: { price: np } })
    ok(e1.status === 200 && near((await Trade.findById(a.doc._id)).pendingPrice, np, 1e-9), 'web edits a pending price', `${e1.status} ${JSON.stringify(e1.data)}`)
    const np2 = +(RAW[b.sym].bid + 0.004).toFixed(5)
    const e2 = await http('PUT', `/api/v1/orders/${b.doc._id}`, { token, body: { price: np2, take_profit: +(np2 - 0.002).toFixed(5) } })
    ok(e2.status === 200 && near((await Trade.findById(b.doc._id)).pendingPrice, np2, 1e-9), 'desktop edits a pending price and target', `${e2.status} ${JSON.stringify(e2.data)}`)
    a.good = np; b.good = np2
  }
  // cancel one through each client
  {
    const c1 = placed.find(p => p.side === 'BUY' && p.kind === 'STOP' && p.client === 'web')
    const c2 = placed.find(p => p.side === 'SELL' && p.kind === 'STOP' && p.client === 'desktop')
    const bal = await balanceOf(c1.acc)
    const x1 = await http('POST', '/api/trade/cancel', { token, body: { tradeId: String(c1.doc._id) } })
    const x2 = await http('DELETE', `/api/v1/orders/${c2.doc._id}`, { token })
    const d1 = await Trade.findById(c1.doc._id), d2 = await Trade.findById(c2.doc._id)
    ok(x1.status === 200 && d1.status === 'CANCELLED', 'web cancels a pending order')
    ok(x2.status === 200 && d2.status === 'CANCELLED' && d2.closedAt, 'desktop cancels a pending order (stamped)')
    ok(near(await balanceOf(c1.acc), bal, 1e-9), 'a cancelled order costs nothing')
    placed.splice(placed.indexOf(c1), 1); placed.splice(placed.indexOf(c2), 1)
  }
  // fill every remaining one by moving its own market through it
  for (const p of placed) {
    const pq = RAW[p.sym]
    const spread = pq.ask - pq.bid
    const target = p.good
    let bid, ask
    if (p.side === 'BUY') { ask = p.kind === 'LIMIT' ? target - 0.0001 : target + 0.0001; bid = ask - spread }
    else { bid = p.kind === 'LIMIT' ? target + 0.0001 : target - 0.0001; ask = bid + spread }
    const bal = await balanceOf(p.acc)
    const fills = await engine.checkPendingOrders(pricesWith(p.sym, bid, ask))
    const doc = await Trade.findById(p.doc._id)
    const tag = `${p.side} ${p.kind} ${p.sym} (${p.client})`
    ok(doc.status === 'OPEN' && fills.some(f => String(f.trade._id) === String(doc._id)), `${tag}: fills when the market reaches it`,
       `${doc.status}, fills ${fills.length}`)
    ok(fills.length === 1, `${tag}: and nothing else fills with it`, fills.length)
    ok(near(doc.openPrice, p.side === 'BUY' ? ask : bid, 1e-9), `${tag}: fills at the market price`)
    ok(near(bal - await balanceOf(p.acc), doc.commission, 1e-6), `${tag}: the fill pays its commission once`, `${bal - await balanceOf(p.acc)} vs ${doc.commission}`)
    await holdBack(doc._id)
    const c = await closeVia('v1', token, doc)
    ok(c.status === 200, `${tag}: the filled position closes`, `${c.status} ${JSON.stringify(c.data)}`)
  }

  /* 4. Partial closes through each path that offers one */
  console.log('\n── partial close ──')
  {
    const acc = id('desktop')
    const { trade } = await openVia('desktop', token, acc, 'XAUUSD', 'BUY', 0.3)
    await holdBack(trade._id)
    const bad = await closeVia('v1', token, trade, 0.015)
    ok(bad.status === 400, 'a slice off the 0.01 lot grid is refused')
    const whole = await closeVia('v1', token, trade, 0.3)
    ok(whole.status === 200 && (await Trade.findById(trade._id)).status === 'CLOSED', 'asking for all the lots closes it fully')
    const { trade: t2 } = await openVia('desktop', token, acc, 'XAUUSD', 'SELL', 0.3)
    await holdBack(t2._id)
    const bal = await balanceOf(acc)
    const a = await closeVia('v1', token, t2, 0.1)
    const b = await closeVia('v1', token, t2, 0.1)
    const parent = await Trade.findById(t2._id)
    const slices = await Trade.find({ tradingAccountId: t2.tradingAccountId, status: 'CLOSED', symbol: 'XAUUSD', side: 'SELL', quantity: 0.1, createdAt: { $gt: t2.createdAt } })
    ok(a.status === 200 && b.status === 200 && near(parent.quantity, 0.1, 1e-9) && parent.status === 'OPEN', 'two partials leave 0.1 open')
    const sum = slices.reduce((s, t) => s + t.realizedPnl, 0)
    ok(near(await balanceOf(acc) - bal, sum), 'partials move the balance by exactly the slices\' P&L')
    const each = expectedPnl('XAUUSD', 'SELL', t2.openPrice, RAW.XAUUSD.ask, 0.1) - commission('XAUUSD', 0.1, RAW.XAUUSD.ask)
    ok(slices.every(s => near(s.realizedPnl, each)), 'each slice = its price move − its close commission', slices.map(s => s.realizedPnl).join(','))
    const last = await closeVia('web', token, parent)
    ok(last.status === 200 && (await Trade.findById(t2._id)).status === 'CLOSED', 'the remainder closes from the web')
  }

  /* 5. Rejections, on every client */
  console.log('\n── rejections ──')
  for (const client of openers) {
    const big = await openVia(client, token, id('small'), 'EURUSD', 'BUY', 5)
    ok(big.r.status === 400 && !big.trade, `${client}: an order the margin cannot carry is refused`, big.r.status)
    const nk = await openVia(client, tokenNoKyc, nokycAcct, 'EURUSD', 'BUY', 0.1)
    ok(nk.r.status === 403 && !nk.trade, `${client}: no KYC, no trade`, nk.r.status)
    const sus = await openVia(client, token, id('suspended'), 'EURUSD', 'BUY', 0.1)
    ok(sus.r.status >= 400 && !sus.trade, `${client}: a suspended account cannot trade`, sus.r.status)
    const zero = await openVia(client, token, id(accountFor[client]), 'EURUSD', 'BUY', 0)
    ok(zero.r.status === 400 && !zero.trade, `${client}: zero volume is refused`, zero.r.status)
    const unk = await openVia(client, token, id(accountFor[client]), 'NOTREAL', 'BUY', 0.1)
    ok(unk.r.status >= 400 && !unk.trade, `${client}: an unknown symbol is refused`, unk.r.status)
  }
  {
    // nobody closes or edits someone else's position
    const { trade } = await openVia('web', token, id('web'), 'EURUSD', 'BUY', 0.1)
    await holdBack(trade._id)
    const x1 = await http('POST', '/api/trade/close', { token: tokenNoKyc, body: { tradeId: String(trade._id) } })
    const x2 = await http('POST', `/api/v1/positions/${trade._id}/close`, { token: tokenNoKyc, body: {} })
    const x3 = await http('PUT', `/api/v1/positions/${trade._id}`, { token: tokenNoKyc, body: { stop_loss: null } })
    const x4 = await http('POST', '/api/algo/trade', { token: tokenNoKyc, account: id('web'), body: { action: 'CLOSE', symbol: 'EURUSD' } })
    ok([x1, x2, x3, x4].every(x => x.status >= 400) && (await Trade.findById(trade._id)).status === 'OPEN',
       'another user cannot close or edit the position on any path', [x1, x2, x3, x4].map(x => x.status).join('/'))
    await closeVia('web', token, trade)
  }

  /* 6. The same account read through all three clients */
  console.log('\n── account totals agree across clients ──')
  {
    const acc = id('app')
    const o1 = await openVia('app', token, acc, 'EURUSD', 'BUY', 0.2)
    const o2 = await openVia('desktop', token, acc, 'XAUUSD', 'SELL', 0.1)
    const o3 = await openVia('web', token, acc, 'USDJPY', 'BUY', 0.1)
    const web = (await http('GET', `/api/trade/summary/${acc}`, { token })).data
    const w = web?.summary || web?.account || web
    const desk = (await http('GET', '/api/algo/account', { token, account: acc })).data
    const app = (await http('GET', `/api/v1/portfolio/summary?account_id=${acc}`, { token })).data
    ok(near(w.equity, desk.equity) && near(desk.equity, Number(app.equity)), 'equity: web = desktop = app',
       `${w.equity} / ${desk.equity} / ${app.equity}`)
    ok(near(w.usedMargin, desk.margin_used) && near(w.freeMargin, desk.free_margin), 'used and free margin: web = desktop',
       `${w.usedMargin}/${desk.margin_used} ${w.freeMargin}/${desk.free_margin}`)
    const pos = (await http('GET', `/api/v1/positions?account_id=${acc}`, { token })).data
    const webOpen = (await http('GET', `/api/trade/open/${acc}`, { token })).data
    const webList = webOpen?.trades || webOpen
    ok(pos.length === 3 && Array.isArray(webList) && webList.length === 3, 'both terminals list the same 3 positions',
       `${pos.length} / ${Array.isArray(webList) ? webList.length : JSON.stringify(webOpen).slice(0, 80)}`)
    for (const t of [o1.trade, o2.trade, o3.trade]) await holdBack(t._id)
    const all = await Promise.all([o1, o2, o3].map(o => closeVia('v1', token, o.trade)))
    ok(all.every(c => c.status === 200), 'all three close')
  }

  /* 7. Stop-out */
  console.log('\n── stop-out ──')
  {
    const acc = id('small')
    const { r, trade } = await openVia('web', token, acc, 'EURUSD', 'BUY', 0.2)
    ok(r.status === 200, 'small account opens 0.2 lots')
    if (trade) {
      const fine = await engine.checkStopOut(acc, pricesWith('EURUSD', q.bid - 0.0002, q.ask - 0.0002))
      ok(fine && !fine.stopOutTriggered && (await Trade.findById(trade._id)).status === 'OPEN', 'a small dip does not stop it out')
      const res = await engine.checkStopOut(acc, pricesWith('EURUSD', q.bid - 0.0145, q.ask - 0.0145))
      const t = await Trade.findById(trade._id)
      ok(res?.stopOutTriggered && t.status === 'CLOSED' && t.closedBy === 'STOP_OUT', 'below the stop-out level every position is closed',
         JSON.stringify({ trig: res?.stopOutTriggered, ml: res?.finalMarginLevel }))
      ok((await balanceOf(acc)) >= 0, 'balance never goes below zero')
    }
  }

  /* 8. Copy trading: open, partial, brackets, close — each reaches the follower once */
  console.log('\n── copy trading ──')
  {
    const M = id('master')
    const followerTrades = async () => Trade.find({ tradingAccountId: F._id }).sort({ createdAt: 1 })
    const { r, trade } = await openVia('web', token, M, 'EURUSD', 'BUY', 0.4)
    await sleep(300)
    let ft = (await followerTrades()).filter(t => t.status === 'OPEN')
    ok(r.status === 200 && ft.length === 1 && near(ft[0].quantity, 0.2, 1e-9), 'web master order is copied to the follower (0.2 fixed)',
       ft.map(t => t.quantity).join(','))
    const d = await openVia('desktop', token, M, 'XAUUSD', 'SELL', 0.1)
    await sleep(300)
    ok((await followerTrades()).filter(t => t.status === 'OPEN').length === 2, 'desktop master order is copied too')

    const newSl = +(q.bid - 0.003).toFixed(5)
    await http('PUT', `/api/v1/positions/${trade._id}`, { token, body: { stop_loss: newSl } })
    await sleep(300)
    const link = await CopyTrade.findOne({ masterTradeId: trade._id })
    const fol = link ? await Trade.findById(link.followerTradeId) : null
    ok(fol && near(fol.sl, newSl, 1e-9), 'a desktop SL edit reaches the follower', fol?.sl)

    await holdBack(trade._id); if (fol) await holdBack(fol._id)
    const p = await closeVia('v1', token, trade, 0.2)
    await sleep(800)
    const fAfter = fol ? await Trade.findById(fol._id) : null
    ok(p.status === 200 && fAfter && near(fAfter.quantity, 0.1, 1e-9), 'a master partial close halves the follower too', fAfter?.quantity)

    const fbal = await balanceOf(F._id)
    const c = await closeVia('web', token, await Trade.findById(trade._id))
    await sleep(1200)
    const fClosed = await Trade.find({ tradingAccountId: F._id, symbol: 'EURUSD', status: 'CLOSED' })
    const fOpen = await Trade.find({ tradingAccountId: F._id, symbol: 'EURUSD', status: 'OPEN' })
    ok(c.status === 200 && fOpen.length === 0, 'closing the master closes the follower')
    const credited = (await balanceOf(F._id)) - fbal
    const lastFollowerClose = fClosed.sort((x, y) => y.closedAt - x.closedAt)[0]
    ok(near(credited, lastFollowerClose.realizedPnl), 'the follower is credited exactly once', `${credited} vs ${lastFollowerClose.realizedPnl}`)
    await holdBack(d.trade._id)
    await closeVia('desktop-all', token, d.trade)
    await sleep(800)
    ok((await followerTrades()).every(t => t.status !== 'OPEN'), 'desktop Close-All on the master closes the follower copy')
  }

  /* 9. Every account reconciles to the cent */
  console.log('\n── reconciliation ──')
  for (const name of ['web', 'desktop', 'app', 'master', 'follower']) {
    const a = await TradingAccount.findById(id(name))
    const trades = await Trade.find({ tradingAccountId: a._id })
    const realized = trades.filter(t => t.status === 'CLOSED').reduce((s, t) => s + (t.realizedPnl || 0), 0)
    const paid = trades.filter(t => t.status === 'OPEN' || t.status === 'CLOSED').reduce((s, t) => s + (t.commission || 0), 0)
    const open = trades.filter(t => t.status === 'OPEN').length
    const want = START + realized - paid
    ok(near(a.balance, want, 0.02) && open === 0,
       `${name}: balance = start + realized − commissions, nothing left open`,
       `${a.balance.toFixed(2)} vs ${want.toFixed(2)} (open ${open})`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await mongoose.disconnect()
  process.exit(fail ? 1 : 0)
}

const mode = process.argv[2]
if (mode === 'seed') await seed()
else if (mode === 'run') await run()
else { console.log('usage: node scripts/testTradingFlows.mjs seed|run'); process.exit(2) }
