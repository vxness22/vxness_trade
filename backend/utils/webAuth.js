// Auth for the web trading API (/api/trade).
//
// These routes historically took userId and tradingAccountId straight from the
// request body and trusted them, with no credential at all. Anyone who knew (or
// guessed) an id could open, close or re-bracket someone else's position. That
// is how a GBPUSD trade ended up carrying a stop of 4372 — a gold price — which
// the SL/TP sweep then filled, minting $4,370,650 into a $5,105 account.
//
// The rule here is the same one /api/v1 and /api/algo already follow: the user
// comes from a verified token, never from the payload, and the account or trade
// being acted on must actually belong to that user. A client-supplied userId is
// ignored outright rather than merely cross-checked, so a stale or spoofed id in
// the body cannot influence anything.

import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import TradingAccount from '../models/TradingAccount.js'
import ChallengeAccount from '../models/ChallengeAccount.js'
import Trade from '../models/Trade.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

function bearer(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

// The web app's login (routes/auth.js) signs { id: userId }, the same claim the
// terminal uses, so one verifier serves both.
export async function webAuth(req, res, next) {
  try {
    const token = bearer(req)
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Please sign in again to place or change a trade.',
        code: 'AUTH_REQUIRED',
      })
    }

    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch (e) {
      return res.status(401).json({
        success: false,
        message: e.name === 'TokenExpiredError' ? 'Session expired — please sign in again.' : 'Invalid session.',
        code: 'AUTH_INVALID',
      })
    }

    const user = await User.findById(decoded.id).select('firstName email kycApproved isBlocked isBanned')
    if (!user) return res.status(401).json({ success: false, message: 'User not found', code: 'AUTH_INVALID' })
    if (user.isBanned) return res.status(403).json({ success: false, message: 'Account banned', code: 'BANNED' })
    if (user.isBlocked) return res.status(403).json({ success: false, message: 'Account blocked', code: 'BLOCKED' })

    req.authUser = user
    next()
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message })
  }
}

// Resolves a trading OR challenge account and confirms it belongs to req.authUser.
export async function ownedAccount(req, accountId) {
  if (!accountId) return null
  const uid = String(req.authUser._id)

  const live = await TradingAccount.findById(accountId).populate('accountTypeId')
  if (live) return String(live.userId) === uid ? live : null

  const challenge = await ChallengeAccount.findById(accountId)
  if (challenge) return String(challenge.userId) === uid ? challenge : null

  return null
}

// Resolves a trade and confirms it belongs to req.authUser.
export async function ownedTrade(req, tradeId) {
  if (!tradeId) return null
  const trade = await Trade.findById(tradeId)
  if (!trade) return null
  return String(trade.userId) === String(req.authUser._id) ? trade : null
}

export function denyAccount(res) {
  // Deliberately the same message whether the account is missing or simply
  // someone else's — probing for valid ids should not be informative.
  return res.status(403).json({
    success: false,
    message: 'Trading account not found for this user',
    code: 'NOT_YOUR_ACCOUNT',
  })
}

export function denyTrade(res) {
  return res.status(403).json({
    success: false,
    message: 'Trade not found for this user',
    code: 'NOT_YOUR_TRADE',
  })
}
