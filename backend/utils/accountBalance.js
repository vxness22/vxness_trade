// Every change to a trading account's balance, as ONE atomic database update.
//
// The platform used to move balances read → modify → save, everywhere. Two of
// those on one account at the same moment — the SL/TP sweep and a trader's own
// close, web and desktop closing together, a transfer landing while a position
// closes, an admin adjustment during a fill — both read the same starting
// balance, and the second save wrote over the first. One of the two changes
// simply vanished from the account. Each function here is a single update the
// database applies to whatever the balance is at that instant, so concurrent
// moves always add up.

import mongoose from 'mongoose'
import TradingAccount from '../models/TradingAccount.js'

const oid = (v) => new mongoose.Types.ObjectId(String(v?._id ?? v))

// Add (or, with a negative delta, subtract) an amount. `floorZero` keeps the
// balance from going below zero, which is how admin trade edits behave.
export async function addToBalance(accountId, delta, { floorZero = false } = {}) {
  const d = Number(delta) || 0
  const _id = oid(accountId)
  if (!floorZero || d >= 0) {
    await TradingAccount.collection.updateOne({ _id }, { $inc: { balance: d } })
  } else {
    await TradingAccount.collection.updateOne({ _id }, [{
      $set: { balance: { $max: [0, { $add: ['$balance', d] }] } },
    }])
  }
  return TradingAccount.findById(_id)
}

// Take an amount out ONLY if the balance covers it — the check and the debit
// are one operation, so two withdrawals cannot both pass the check. Returns the
// updated account, or null when the balance was insufficient.
export async function debitBalance(accountId, amount) {
  const a = Number(amount) || 0
  return TradingAccount.findOneAndUpdate(
    { _id: oid(accountId), balance: { $gte: a } },
    { $inc: { balance: -a } },
    { new: true }
  )
}

// A realized trade P&L. Profit is added to the balance. A loss comes out of
// the balance first and, once that is exhausted, out of credit. Every
// expression in a single $set stage reads the document as it was BEFORE the
// stage, so credit is reduced by exactly what the balance could not cover.
export async function applyRealizedPnl(accountId, pnl) {
  const amount = Number(pnl) || 0
  const _id = oid(accountId)
  if (amount >= 0) {
    return TradingAccount.collection.updateOne({ _id }, { $inc: { balance: amount } })
  }
  const loss = -amount
  return TradingAccount.collection.updateOne({ _id }, [{
    $set: {
      balance: { $max: [0, { $subtract: ['$balance', loss] }] },
      credit: { $max: [0, { $subtract: [
        { $ifNull: ['$credit', 0] },
        { $max: [0, { $subtract: [loss, '$balance'] }] },
      ] }] },
    },
  }])
}

// A charge (commission) taken from the balance, never below zero.
export async function chargeBalance(accountId, charge) {
  const c = Number(charge) || 0
  if (!(c > 0)) return null
  return TradingAccount.collection.updateOne({ _id: oid(accountId) }, [{
    $set: { balance: { $max: [0, { $subtract: ['$balance', c] }] } },
  }])
}
