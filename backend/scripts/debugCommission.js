// Debug commission resolution end-to-end against the live DB.
// Usage:
//   node scripts/debugCommission.js XAUUSD
//   node scripts/debugCommission.js XAUUSD 17148206
//
// Prints: charges in DB, user account + accountType, then simulates getChargesForTrade.

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Charges from '../models/Charges.js'
import AccountType from '../models/AccountType.js'

dotenv.config()

const symbolArg = (process.argv[2] || 'XAUUSD').toUpperCase()
const accountNumberArg = process.argv[3] || null

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to:', process.env.MONGODB_URI.replace(/:[^:@]+@/, ':***@'))
  console.log('DB name:', mongoose.connection.name)
  console.log('---')

  // 1. Show all active charges
  const allCharges = await Charges.find({ isActive: true }).lean()
  console.log(`Found ${allCharges.length} active Charges rule(s):`)
  for (const c of allCharges) {
    console.log({
      _id: String(c._id),
      level: c.level,
      instrumentSymbol: c.instrumentSymbol,
      segment: c.segment,
      accountTypeId: c.accountTypeId ? String(c.accountTypeId) : null,
      userId: c.userId ? String(c.userId) : null,
      commissionValue: c.commissionValue,
      commissionType: c.commissionType,
      spreadValue: c.spreadValue,
    })
  }
  console.log('---')

  // 2. Find target account
  const Account = mongoose.connection.collection('accounts')
  let account = null
  if (accountNumberArg) {
    account = await Account.findOne({ accountNumber: accountNumberArg })
    if (!account) account = await Account.findOne({ accountNumber: Number(accountNumberArg) })
  } else {
    account = await Account.findOne({})
  }

  if (!account) {
    console.log('No account found. Pass account number as 2nd arg.')
    await mongoose.disconnect()
    return
  }

  console.log('Account:', {
    _id: String(account._id),
    accountNumber: account.accountNumber,
    accountTypeId: account.accountTypeId ? String(account.accountTypeId) : null,
    accountTypeIdType: account.accountTypeId ? typeof account.accountTypeId : 'undefined',
    userId: account.userId ? String(account.userId) : null,
  })

  const at = account.accountTypeId ? await AccountType.findById(account.accountTypeId).lean() : null
  console.log('AccountType:', at ? { _id: String(at._id), name: at.name, minSpread: at.minSpread, commission: at.commission } : null)
  console.log('---')

  // 3. Simulate the exact filter from Charges.getChargesForTrade
  const accountTypeId = account.accountTypeId ? String(account.accountTypeId) : null
  const userId = account.userId ? String(account.userId) : null
  const symNorm = symbolArg

  console.log(`Simulating filter for symbol=${symNorm}, accountTypeId=${accountTypeId}, userId=${userId}`)
  console.log('')

  for (const c of allCharges) {
    const cAcctType = c.accountTypeId ? String(c.accountTypeId) : null
    const cUserId = c.userId ? String(c.userId) : null
    const cSym = (c.instrumentSymbol || '').toUpperCase().trim()
    let verdict = '?'
    let reason = ''

    if (c.level === 'INSTRUMENT') {
      if (cSym !== symNorm) {
        verdict = 'SKIP'
        reason = `instrument mismatch (rule=${cSym}, want=${symNorm})`
      } else if (cAcctType && cAcctType !== accountTypeId) {
        verdict = 'SKIP'
        reason = `accountTypeId mismatch (rule=${cAcctType}, account=${accountTypeId})`
      } else {
        verdict = 'MATCH'
      }
    } else if (c.level === 'USER') {
      if (cUserId !== userId) {
        verdict = 'SKIP'
        reason = `userId mismatch (rule=${cUserId}, user=${userId})`
      } else {
        verdict = 'MATCH'
      }
    } else if (c.level === 'ACCOUNT_TYPE') {
      if (cAcctType !== accountTypeId) {
        verdict = 'SKIP'
        reason = `accountTypeId mismatch (rule=${cAcctType}, account=${accountTypeId})`
      } else {
        verdict = 'MATCH'
      }
    } else {
      verdict = 'MATCH (level=' + c.level + ')'
    }

    console.log(`[${verdict}] ${c.level} rule ${String(c._id)} commission=${c.commissionValue} ${reason}`)
  }
  console.log('---')

  // 4. Call the actual function
  const merged = await Charges.getChargesForTrade(userId, symNorm, 'Metals', accountTypeId, allCharges)
  console.log('getChargesForTrade result:', {
    commissionValue: merged.commissionValue,
    commissionType: merged.commissionType,
    spreadValue: merged.spreadValue,
  })

  await mongoose.disconnect()
}

run().catch(async (e) => {
  console.error('Error:', e)
  try { await mongoose.disconnect() } catch {}
  process.exit(1)
})
