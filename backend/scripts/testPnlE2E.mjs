// END-TO-END test against the REAL production code paths.
// Uses an isolated database (vxness_pnl_e2e) — never touches vxness_local or prod.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/vxness_pnl_e2e'

import mongoose from 'mongoose'
import Trade from '../models/Trade.js'
import TradingAccount from '../models/TradingAccount.js'
import AccountType from '../models/AccountType.js'
import User from '../models/User.js'
import tradeEngine from '../services/tradeEngine.js'
import infowayService from '../services/infowayService.js'

// ---- INDEPENDENT expected-value calculator -------------------------------
// Deliberately does NOT import symbolMeta. If this and the engine agree, two
// separate implementations agree — not one implementation agreeing with itself.
const CRYPTO = new Set(['BTCUSD','ETHUSD','SOLUSD','DOGEUSD','XRPUSD','LTCUSD','BCHUSD','BNBUSD','ADAUSD'])
const NONFX = (s) => CRYPTO.has(s) || /^(XAU|XAG|XPT|XPD)/.test(s) || ['USOIL','UKOIL','NGAS','COPPER'].includes(s)

function expectedPnl(sym, side, open, close, lots, cs) {
  const raw = side === 'BUY' ? (close - open) * lots * cs : (open - close) * lots * cs
  if (NONFX(sym)) return raw
  const base = sym.slice(0, 3), quote = sym.slice(3, 6)
  if (quote === 'USD') return raw
  if (base === 'USD') return raw / close              // quote ccy per USD = the price itself
  const d = infowayService.getPrice(quote + 'USD')
  if (d) return raw * ((d.bid + d.ask) / 2)
  const inv = infowayService.getPrice('USD' + quote)
  return raw * (2 / (inv.bid + inv.ask))
}

const CASES = [
  // sym,      side,  open,     close,    lots, contractSize, label
  ['EURUSD',  'BUY',  1.13200,  1.14200,  1,    100000, 'major, +100 pips'],
  ['EURUSD',  'SELL', 1.13200,  1.12200,  1,    100000, 'major, short win'],
  ['GBPUSD',  'BUY',  1.34500,  1.34000,  2,    100000, 'major, LOSS'],
  ['USDJPY',  'BUY',  145.500,  146.500,  1,    100000, 'USD-base JPY  <-- the bug'],
  ['USDJPY',  'SELL', 145.500,  146.500,  5,    100000, 'USD-base JPY, big LOSS'],
  ['GBPJPY',  'BUY',  195.800,  196.800,  1,    100000, 'JPY cross'],
  ['EURJPY',  'SELL', 164.800,  164.300,  3,    100000, 'JPY cross, short win'],
  ['EURGBP',  'BUY',  0.84200,  0.85200,  1,    100000, 'non-JPY cross'],
  ['USDCHF',  'SELL', 0.80500,  0.80000,  1,    100000, 'USD-base CHF'],
  ['USDCAD',  'BUY',  1.39500,  1.40500,  1,    100000, 'USD-base CAD'],
  ['USDZAR',  'BUY',  18.2000,  18.3000,  1,    100000, 'exotic USD-base'],
  ['ZARJPY',  'BUY',  8.00000,  8.05000,  1,    100000, 'exotic JPY cross'],
  ['XAUUSD',  'BUY',  4155.40,  4165.40,  1,    100,    'metal'],
  ['XAGUSD',  'SELL', 32.8500,  32.5500,  1,    5000,   'metal, short win'],
  ['USOIL',   'BUY',  62.3000,  63.3000,  1,    1000,   'commodity'],
  ['BTCUSD',  'BUY',  103500.0, 104500.0, 1,    1,      'crypto'],
  ['ETHUSD',  'SELL', 2480.00,  2400.00,  2,    1,      'crypto, short win'],
]

const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2)

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  await mongoose.connection.dropDatabase()   // start clean
  console.log(`DB: ${mongoose.connection.name} (isolated)\n`)

  const at = await AccountType.create({ name: 'E2E', minDeposit: 10, leverage: '1:100' })
  const user = await User.create({
    firstName: 'E2E', email: `e2e${Date.now()}@test.local`, phone: '0000000000',
    password: 'testpass123', kycApproved: true,
  })

  let pass = 0, fail = 0
  console.log('symbol   side  lots  label                       engine P&L    expected     balance Δ    result')
  console.log('-'.repeat(104))

  for (const [sym, side, open, close, lots, cs, label] of CASES) {
    const acc = await TradingAccount.create({
      userId: user._id, accountTypeId: at._id,
      accountId: await TradingAccount.generateAccountId(),
      balance: 100000, credit: 0, leverage: '1:100',
    })

    const t = await Trade.create({
      userId: user._id, tradingAccountId: acc._id,
      tradeId: await Trade.generateTradeId(),
      symbol: sym, segment: 'Forex', side, orderType: 'MARKET',
      quantity: lots, openPrice: open, marginUsed: 0, leverage: 100,
      contractSize: cs, commission: 0, swap: 0, status: 'OPEN',
      openedAt: new Date(Date.now() - 10 * 60 * 1000),   // past the 3-min hold
    })

    // Close through the REAL engine, at the exact price for this side.
    const bid = side === 'BUY' ? close : close - 0
    const ask = side === 'BUY' ? close + 0 : close
    const { realizedPnl } = await tradeEngine.closeTrade(t._id, bid, ask, 'USER')

    const after = await TradingAccount.findById(acc._id)
    const delta = after.balance - 100000
    const want = expectedPnl(sym, side, open, close, lots, cs)

    const pnlOk = Math.abs(realizedPnl - want) < 0.01
    const balOk = Math.abs(delta - want) < 0.01
    const ok = pnlOk && balOk
    ok ? pass++ : fail++

    console.log(
      sym.padEnd(8), side.padEnd(5), String(lots).padEnd(5), label.padEnd(27),
      money(realizedPnl).padStart(12), money(want).padStart(12), money(delta).padStart(12),
      '   ', ok ? 'PASS' : `FAIL (pnl ${pnlOk} bal ${balOk})`
    )
  }

  // ---- floating P&L / equity through getAccountSummary ----
  console.log('\n--- floating P&L via getAccountSummary (mixed open book) ---')
  const acc = await TradingAccount.create({
    userId: user._id, accountTypeId: at._id,
    accountId: await TradingAccount.generateAccountId(),
    balance: 10000, credit: 0, leverage: '1:100',
  })
  const openSet = [['USDJPY','BUY',144.0,1,100000], ['EURUSD','BUY',1.1220,1,100000], ['XAUUSD','BUY',4100.0,1,100], ['GBPJPY','SELL',197.0,2,100000]]
  const prices = {}
  let wantFloat = 0
  for (const [sym, side, open, lots, cs] of openSet) {
    await Trade.create({
      userId: user._id, tradingAccountId: acc._id, tradeId: await Trade.generateTradeId(),
      symbol: sym, segment: 'Forex', side, orderType: 'MARKET', quantity: lots,
      openPrice: open, marginUsed: 100, leverage: 100, contractSize: cs,
      commission: 0, swap: 0, status: 'OPEN',
    })
    const live = infowayService.getPrice(sym)
    prices[sym] = { bid: live.bid, ask: live.ask }
    wantFloat += expectedPnl(sym, side, open, side === 'BUY' ? live.bid : live.ask, lots, cs)
  }
  const openTrades = await Trade.find({ tradingAccountId: acc._id, status: 'OPEN' })
  const sum = await tradeEngine.getAccountSummary(acc._id, openTrades, prices)
  const floatOk = Math.abs(sum.floatingPnl - wantFloat) < 0.01
  floatOk ? pass++ : fail++
  console.log(`floating P&L engine ${money(sum.floatingPnl)}  expected ${money(wantFloat)}  equity ${money(sum.equity)}   ${floatOk ? 'PASS' : 'FAIL'}`)

  // ---- margin ----
  console.log('\n--- margin (1 lot, 1:100) ---')
  for (const [sym, px, want] of [['EURUSD',1.1321,1132.10],['USDJPY',145.51,1000],['XAUUSD',4155.65,4155.65],['GBPJPY',195.81,1345.10]]) {
    const m = tradeEngine.calculateMargin(1, px, '1:100', undefined, sym)
    const ok = Math.abs(m - want) < 1
    ok ? pass++ : fail++
    console.log(`  ${sym.padEnd(8)} margin ${money(m).padStart(11)}   expected ~${money(want)}   ${ok ? 'PASS' : 'FAIL'}`)
  }

  // ---- SL/TP auto-close path (the background loop that closes trades) ----
  console.log('\n--- SL/TP auto-close path (checkSlTpForAllTrades) ---')
  const slAcc = await TradingAccount.create({
    userId: user._id, accountTypeId: at._id,
    accountId: await TradingAccount.generateAccountId(),
    balance: 50000, credit: 0, leverage: '1:100',
  })
  await Trade.create({
    userId: user._id, tradingAccountId: slAcc._id, tradeId: await Trade.generateTradeId(),
    symbol: 'USDJPY', segment: 'Forex', side: 'BUY', orderType: 'MARKET', quantity: 1,
    openPrice: 145.50, marginUsed: 1000, leverage: 100, contractSize: 100000,
    commission: 0, swap: 0, status: 'OPEN', takeProfit: 146.50, tp: 146.50,
    openedAt: new Date(Date.now() - 10 * 60 * 1000),
  })
  const fired = await tradeEngine.checkSlTpForAllTrades({ USDJPY: { bid: 146.60, ask: 146.62 } })
  const slDelta = (await TradingAccount.findById(slAcc._id)).balance - 50000
  const slWant = expectedPnl('USDJPY', 'BUY', 145.50, 146.50, 1, 100000)
  const slOk = fired.length === 1 && Math.abs(slDelta - slWant) < 0.01
  slOk ? pass++ : fail++
  console.log(`  TP fired=${fired.length}  balance Δ ${money(slDelta)}  expected ${money(slWant)}   ${slOk ? 'PASS' : 'FAIL'}`)

  // ---- REGRESSION PROOF: what the OLD formula would have booked ----
  console.log('\n--- regression proof: old formula vs fixed engine ---')
  console.log('  symbol     OLD would book   engine books    inflation')
  for (const [sym, side, open, close, lots, cs] of [
    ['EURUSD', 'BUY', 1.132, 1.142, 1, 100000],
    ['USDJPY', 'BUY', 145.5, 146.5, 1, 100000],
    ['GBPJPY', 'BUY', 195.8, 196.8, 1, 100000],
    ['EURGBP', 'BUY', 0.842, 0.852, 1, 100000],
    ['XAUUSD', 'BUY', 4155.4, 4165.4, 1, 100],
  ]) {
    const old = side === 'BUY' ? (close - open) * lots * cs : (open - close) * lots * cs
    const now = tradeEngine.calculatePnl(side, open, close, lots, cs, sym)
    console.log(`  ${sym.padEnd(10)} ${money(old).padStart(14)} ${money(now).padStart(14)}      ${(old / now).toFixed(1)}x`)
  }

  await mongoose.connection.dropDatabase()
  console.log('\n' + '='.repeat(104))
  console.log(fail === 0 ? `ALL ${pass} ASSERTIONS PASSED` : `${pass} passed, ${fail} FAILED`)
  console.log('(test database dropped)')
  process.exitCode = fail === 0 ? 0 : 1
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect(); process.exit() })
