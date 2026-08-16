// Audit (and optionally correct) balances inflated by the quote-currency P&L bug.
//
// Until the pnlUsd() fix, every P&L was computed as `Δprice * lots * contractSize`
// and booked as dollars. That product is denominated in the pair's QUOTE currency,
// so any non-USD-quoted symbol was mis-booked:
//   USDJPY / any JPY cross -> yen booked as dollars  -> ~146x too large
//   USDCHF / USDCAD        -> chf/cad booked as usd  -> 20-30% too small
//   EURGBP and other crosses-> quote ccy booked as usd
// Losses were floored (balance clamped at 0), profits were not, so the error
// ratchets balances UPWARD over time.
//
// Usage (from backend/):
//   node scripts/auditQuotePnl.js                       # report every affected account
//   node scripts/auditQuotePnl.js --email=a@b.com       # report one user
//   node scripts/auditQuotePnl.js --account=15669217    # report one trading account
//   node scripts/auditQuotePnl.js --email=a@b.com --apply   # WRITE the correction
//
// Without --apply nothing is written. Read the report first.

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Trade from '../models/Trade.js'
import TradingAccount from '../models/TradingAccount.js'
import User from '../models/User.js'
import infowayService from '../services/infowayService.js'
import { pnlUsd } from '../utils/symbolMeta.js'

dotenv.config()

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v === undefined ? true : v]
  })
)

const APPLY = args.apply === true
const getPrice = (s) => infowayService.getPrice(s)
const usd = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log(`Connected: ${mongoose.connection.name}\n`)

  // ---- resolve which accounts to audit ----
  const accountFilter = {}
  if (args.email) {
    const user = await User.findOne({ email: String(args.email).toLowerCase().trim() })
    if (!user) {
      console.log(`No user with email ${args.email}`)
      return
    }
    accountFilter.userId = user._id
    console.log(`User: ${user.email}  (${user.firstName || ''})  id=${user._id}\n`)
  }
  if (args.account) accountFilter.accountId = String(args.account)

  const accounts = await TradingAccount.find(accountFilter)
  if (!accounts.length) {
    console.log('No trading accounts matched.')
    return
  }

  let grandTotal = 0
  const report = []

  for (const account of accounts) {
    const closed = await Trade.find({ tradingAccountId: account._id, status: 'CLOSED' })
    if (!closed.length) continue

    let overstatement = 0
    let affected = 0
    let sawStopOut = false
    const bySymbol = {}

    for (const t of closed) {
      if (t.closedBy === 'STOP_OUT') sawStopOut = true
      if (!(t.closePrice > 0) || !(t.openPrice > 0)) continue

      // What the old code booked (raw quote-currency product), minus the same
      // charges the close path subtracted.
      const rawOld = t.side === 'BUY'
        ? (t.closePrice - t.openPrice) * t.quantity * t.contractSize
        : (t.openPrice - t.closePrice) * t.quantity * t.contractSize

      const rawNew = pnlUsd(t.symbol, t.side, t.openPrice, t.closePrice, t.quantity, t.contractSize, getPrice)

      const delta = rawOld - rawNew            // > 0 means the account was over-credited
      if (Math.abs(delta) < 0.005) continue

      affected += 1
      overstatement += delta
      const b = (bySymbol[t.symbol] ||= { n: 0, delta: 0 })
      b.n += 1
      b.delta += delta
    }

    if (!affected) continue

    grandTotal += overstatement
    report.push({ account, closed: closed.length, affected, overstatement, bySymbol, sawStopOut })
  }

  if (!report.length) {
    console.log('No trades affected by the quote-currency bug. Nothing to correct.')
    return
  }

  for (const r of report) {
    const corrected = r.account.balance - r.overstatement
    console.log('='.repeat(66))
    console.log(`Account ${r.account.accountId}   (${r.account.isDemo ? 'DEMO' : 'LIVE'})`)
    console.log(`  closed trades      : ${r.closed}  (${r.affected} mis-booked)`)
    console.log(`  current balance    : ${usd(r.account.balance)}`)
    console.log(`  over-credited by   : ${usd(r.overstatement)}`)
    console.log(`  corrected balance  : ${usd(corrected)}`)
    console.log('  by symbol:')
    Object.entries(r.bySymbol)
      .sort((a, b) => b[1].delta - a[1].delta)
      .forEach(([sym, v]) => console.log(`    ${sym.padEnd(10)} ${String(v.n).padStart(4)} trades   ${usd(v.delta)}`))

    if (corrected < 0) {
      console.log('  !! corrected balance is NEGATIVE — the account also took mis-booked')
      console.log('     losses that were clamped at zero. A linear correction is not exact;')
      console.log('     settle this one manually against the deposit history.')
    }
    if (r.sawStopOut) {
      console.log('  !! this account was stop-ZERO\'d at least once (closedBy=STOP_OUT).')
      console.log('     Balance was clamped to 0 then, so the linear correction is approximate.')
    }
  }

  console.log('='.repeat(66))
  console.log(`Accounts affected: ${report.length}   Total over-credit: ${usd(grandTotal)}\n`)

  if (!APPLY) {
    console.log('DRY RUN — nothing written. Re-run with --apply to write corrected balances.')
    return
  }

  console.log('Applying corrections...')
  for (const r of report) {
    const corrected = Math.max(0, r.account.balance - r.overstatement)
    const before = r.account.balance
    r.account.balance = Math.round(corrected * 100) / 100
    await r.account.save()
    console.log(`  ${r.account.accountId}: ${usd(before)} -> ${usd(r.account.balance)}`)
  }
  console.log('\nDone. Realised P&L on the individual trade rows was left untouched —')
  console.log('correct it separately if your reporting reads trade.realizedPnl.')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect(); process.exit() })
