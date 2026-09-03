// Auth helpers for the desktop-terminal API surface (/api/algo + /api/v1).
//
// Unlike the rest of this backend — where routes take userId/accountId straight
// from the request body — every endpoint behind these middlewares derives the
// user from a verified credential and then checks that the requested trading
// account actually belongs to them. Nothing here trusts a client-supplied id.

import jwt from 'jsonwebtoken'
import AlgoKey, { hashSecret } from '../models/AlgoKey.js'
import TradingAccount from '../models/TradingAccount.js'
import User from '../models/User.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

// The terminal parses FastAPI-shaped errors: {"detail": "..."} (see ApiError.h).
// Anything else surfaces to the trader as Qt's generic "server replied: ...".
export function fail(res, status, detail) {
  return res.status(status).json({ detail })
}

export function signAccessToken(userId, claims = {}) {
  // ~45 minutes, matching what the terminal's renewal timer expects.
  // `claims` carries the investor-session markers (ro / acct); a normal sign-in
  // passes nothing and the token looks exactly as it always did.
  return jwt.sign({ id: String(userId), typ: 'terminal', ...claims }, JWT_SECRET, { expiresIn: '45m' })
}

// Requests an investor session is never allowed to make, whatever the UI shows.
//
// An investor signs in with the account's investor password to WATCH it. The
// app hides deposit, withdraw, KYC and the order ticket, but hiding a button is
// not a control — anyone can replay the token against the API directly. So the
// refusal lives here, at the only door every route goes through, and it is a
// deny-list of methods rather than a list of routes: a mutating endpoint added
// later is covered the day it is written, without anyone remembering to.
const READ_ONLY_SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

function bearer(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

// Verifies the JWT and loads the user. Populates req.user.
export async function jwtAuth(req, res, next) {
  try {
    const token = bearer(req)
    if (!token) return fail(res, 401, 'Missing bearer token')

    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch (e) {
      return fail(res, 401, e.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token')
    }

    const user = await User.findById(decoded.id).select('firstName email kycApproved isBlocked isBanned')
    if (!user) return fail(res, 401, 'User not found')
    if (user.isBanned) return fail(res, 403, 'Account banned')
    if (user.isBlocked) return fail(res, 403, 'Account blocked')

    req.user = user
    req.readOnly = decoded.ro === true
    // The one account the investor password was issued for. Routes narrow to it
    // so an investor cannot enumerate the owner's other accounts.
    req.investorAccountId = req.readOnly ? (decoded.acct || null) : null

    if (req.readOnly && !READ_ONLY_SAFE_METHODS.includes(req.method)) {
      return fail(res, 403, 'This is a read-only investor session')
    }

    // Blocking writes is not enough on its own: the routes take account_id as a
    // parameter and check it against the OWNER, who may hold several accounts.
    // Without this an investor given one account's password could read the
    // positions and ledger of every other account that owner has.
    if (req.investorAccountId) {
      const asked = req.query?.account_id || req.body?.account_id || req.params?.id
      if (asked && String(asked) !== String(req.investorAccountId)) {
        return fail(res, 403, 'This investor session is limited to one account')
      }
    }

    next()
  } catch (e) {
    return fail(res, 500, e.message)
  }
}

// Verifies X-Api-Key + X-Api-Secret, falling back to a bearer token plus
// X-Account-Id (ApiClient::makeRequest sends that pair when no key is stored).
// Populates req.user and req.account.
export async function algoAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key']
    const apiSecret = req.headers['x-api-secret']

    if (apiKey && apiSecret) {
      const key = await AlgoKey.findOne({ apiKey: String(apiKey), revoked: false })
      if (!key || key.secretHash !== hashSecret(apiSecret)) {
        return fail(res, 401, 'Invalid API key or secret')
      }

      const account = await TradingAccount.findById(key.tradingAccountId).populate('accountTypeId')
      if (!account) return fail(res, 404, 'Trading account no longer exists')

      const user = await User.findById(key.userId).select('firstName email kycApproved isBlocked isBanned')
      if (!user) return fail(res, 401, 'User not found')
      if (user.isBanned) return fail(res, 403, 'Account banned')
      if (user.isBlocked) return fail(res, 403, 'Account blocked')

      // Best-effort; a write failure must never block a market-data request.
      AlgoKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {})

      req.user = user
      req.account = account
      return next()
    }

    // JWT fallback — the account then has to be named explicitly and verified.
    const token = bearer(req)
    if (!token) return fail(res, 401, 'Missing X-Api-Key or X-Api-Secret')

    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch (e) {
      return fail(res, 401, e.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token')
    }

    const accountId = req.headers['x-account-id']
    if (!accountId) return fail(res, 400, 'Missing X-Account-Id')

    const account = await TradingAccount.findById(String(accountId)).populate('accountTypeId')
    if (!account) return fail(res, 404, 'Trading account not found')
    if (String(account.userId) !== String(decoded.id)) {
      return fail(res, 403, 'That account does not belong to this user')
    }

    const user = await User.findById(decoded.id).select('firstName email kycApproved isBlocked isBanned')
    if (!user) return fail(res, 401, 'User not found')
    if (user.isBanned) return fail(res, 403, 'Account banned')
    if (user.isBlocked) return fail(res, 403, 'Account blocked')

    req.user = user
    req.account = account
    next()
  } catch (e) {
    return fail(res, 500, e.message)
  }
}

// Loads a trading account named by the request and asserts ownership. Used by
// the /api/v1 routes, which are JWT-authenticated and take account_id as a
// query/body parameter.
export async function ownedAccount(userId, accountId) {
  if (!accountId) return null
  let account
  try {
    account = await TradingAccount.findById(String(accountId)).populate('accountTypeId')
  } catch {
    return null // malformed ObjectId
  }
  if (!account) return null
  if (String(account.userId) !== String(userId)) return null
  return account
}
