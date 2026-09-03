// /api/v1/* — the platform surface the desktop terminal uses for everything
// that is not market data: sign-in, account list, the blotter (positions,
// pending orders, history, ledger) and per-position operations.
//
// Authenticated with a ~45-minute JWT plus a rotating `pt_refresh` cookie.
// Every account-scoped route resolves the account through ownedAccount(), so a
// user can only ever read or move their own positions.
//
// Shapes are snake_case and errors are {"detail": "..."} — see ApiClient.cpp
// and ApiError.h in the terminal.

import express from 'express'
import User from '../models/User.js'
import Trade from '../models/Trade.js'
import TradingAccount from '../models/TradingAccount.js'
import Transaction from '../models/Transaction.js'
import Wallet from '../models/Wallet.js'
import MasterTrader from '../models/MasterTrader.js'
import CopyFollower from '../models/CopyFollower.js'
import AccountType from '../models/AccountType.js'
import KYC from '../models/KYC.js'
import { instrumentCatalogue } from './prices.js'
import AlgoKey from '../models/AlgoKey.js'
import TerminalRefreshToken, { REFRESH_TTL_DAYS } from '../models/TerminalRefreshToken.js'
import infowayService, { SUPPORTED_SYMBOLS } from '../services/infowayService.js'
import tradeEngine from '../services/tradeEngine.js'
import { contractSize as symbolContractSize } from '../utils/symbolMeta.js'
import { resolveTradeSegment } from '../utils/tradeSegment.js'
import { jwtAuth, ownedAccount, signAccessToken, fail } from '../utils/terminalAuth.js'
import { validatePendingBrackets } from '../utils/bracketGuard.js'
import { isMarketOpen, marketClosedReason } from '../utils/marketHours.js'
import Challenge from '../models/Challenge.js'
import ChallengeAccount from '../models/ChallengeAccount.js'
import PropSettings from '../models/PropSettings.js'
import propTradingEngine from '../services/propTradingEngine.js'
import { enrichChallengeAccounts } from './propTrading.js'
import { fetchBars } from './charts.js'
import OTP from '../models/OTP.js'
import Admin from '../models/Admin.js'
import PaymentMethod from '../models/PaymentMethod.js'
import IBWallet from '../models/IBWallet.js'
import IBCommissionNew from '../models/IBCommissionNew.js'
import ibEngineNew from '../services/ibEngineNew.js'
import multer from 'multer'
import pathV1 from 'path'
import fsV1 from 'fs'
import { fileURLToPath as fileURLToPathV1 } from 'url'
import EmailSettings from '../models/EmailSettings.js'
import { sendTemplateEmail, generateOTP, isOTPEnabled, getOTPExpiry } from '../services/emailService.js'

const dirnameV1 = pathV1.dirname(fileURLToPathV1(import.meta.url))

const router = express.Router()

const REFRESH_COOKIE = 'pt_refresh'

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  })
}

// cookie-parser is not a dependency of this backend, and adding one for a
// single header would be heavier than reading it.
function readCookie(req, name) {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

/* ─────────────────────────  auth  ───────────────────────── */

// POST /api/v1/auth/login — {email, password}
router.post('/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    if (!email || !password) return fail(res, 400, 'Email and password are required')

    const user = await User.findOne({ email })
    if (!user) return fail(res, 401, 'Invalid email or password')
    if (user.isBanned) return fail(res, 403, user.banReason || 'Account banned')
    if (user.isBlocked) return fail(res, 403, user.blockReason || 'Account blocked')

    const ok = await user.comparePassword(password)
    if (!ok) return fail(res, 401, 'Invalid email or password')

    const accessToken = signAccessToken(user._id)
    const refreshToken = await TerminalRefreshToken.issue(user._id)
    setRefreshCookie(res, refreshToken)

    user.lastLoginAt = new Date()
    await user.save({ validateBeforeSave: false })

    res.json({
      access_token: accessToken,
      token: accessToken,          // the terminal reads either key
      token_type: 'bearer',
      name: user.firstName,
      user: {
        id: String(user._id),
        name: user.firstName,
        full_name: user.firstName,
        email: user.email,
        kyc_approved: !!user.kycApproved,
      },
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/auth/refresh — presents the pt_refresh cookie, gets a new
// access token plus a replacement cookie. The presented token is burned.
router.post('/auth/refresh', async (req, res) => {
  try {
    const presented = readCookie(req, REFRESH_COOKIE)
    if (!presented) return fail(res, 401, 'No refresh cookie presented')

    const rotated = await TerminalRefreshToken.rotate(presented)
    if (!rotated) return fail(res, 401, 'Refresh token is invalid, expired or already used')

    const user = await User.findById(rotated.userId).select('isBlocked isBanned')
    if (!user) return fail(res, 401, 'User not found')
    if (user.isBanned || user.isBlocked) return fail(res, 403, 'Account is not active')

    setRefreshCookie(res, rotated.token)
    res.json({ access_token: signAccessToken(rotated.userId), token_type: 'bearer' })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

/* ────────────────────  accounts + algo keys  ──────────────────── */

// GET /api/v1/accounts — trading accounts belonging to the signed-in user.
router.get('/accounts', jwtAuth, async (req, res) => {
  try {
    // An investor session is pinned to the one account its password unlocked —
    // it must not enumerate the owner's other accounts.
    const scope = { userId: req.user._id, status: { $ne: 'Archived' } }
    if (req.investorAccountId) scope._id = req.investorAccountId

    const accounts = await TradingAccount.find(scope)
      .populate('accountTypeId', 'name isDemo leverage').sort({ createdAt: -1 })

    // Both keys, deliberately. Every mobile screen reads `items` — the account
    // switcher, Transfer, the accounts list — while `accounts` is what this
    // route has always answered with. Sending one and not the other silently
    // empties the app's account list rather than failing loudly, which is
    // exactly how it slipped through.
    const items = accounts.map(a => ({
        // id/_id alongside account_id: every consumer in the app derives an
        // account's identity as `a.id || a._id` — the account switcher, the
        // Transfer picker, and the accounts list's React key. With only
        // account_id present that came out undefined, so every row rendered
        // with the same key and selection had nothing to match on.
        id: String(a._id),
        _id: String(a._id),
        account_id: String(a._id),
        account_number: a.accountId,
        is_demo: !!(a.isDemo || a.accountTypeId?.isDemo),
        currency: 'USD',
        balance: a.balance,
        credit: a.credit,
        leverage: a.leverage,
        type: a.accountTypeId?.name || '',
        status: a.status,
    }))

    res.json({ items, accounts: items })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/algo/generate — {account_id, label} → a key/secret pair.
// The secret is returned exactly once; only its digest is stored.
router.post('/algo/generate', jwtAuth, async (req, res) => {
  try {
    const account = await ownedAccount(req.user._id, req.body?.account_id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')

    const { apiKey, apiSecret } = await AlgoKey.mint(
      req.user._id, account._id, String(req.body?.label || 'Terminal').slice(0, 60)
    )
    res.json({ api_key: apiKey, api_secret: apiSecret, account_id: String(account._id) })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

/* ─────────────────────────  positions  ───────────────────────── */

function liveQuote(symbol) {
  const p = infowayService.getPrice(symbol)
  return p && p.bid > 0 ? p : null
}

function positionJson(t) {
  const q = liveQuote(t.symbol)
  const current = q ? (t.side === 'BUY' ? q.bid : q.ask) : t.openPrice
  const profit = q ? tradeEngine.calculateFloatingPnl(t, q.bid, q.ask) : 0
  return {
    id: String(t._id),
    // The ticket the rest of the platform knows this trade by (T…), which is
    // what admin, support and the statements all quote. `id` stays the Mongo
    // _id because every write route below addresses the trade by it; without
    // this field a desktop client could only show that _id, so the same trade
    // carried two different "ticket numbers" depending on where it was read.
    ticket: t.tradeId || '',
    symbol: t.symbol,
    side: t.side,
    lots: t.quantity,
    open_price: t.openPrice,
    current_price: current,
    stop_loss: t.sl ?? t.stopLoss ?? 0,
    take_profit: t.tp ?? t.takeProfit ?? 0,
    swap: t.swap || 0,
    commission: t.commission || 0,
    profit: Math.round(profit * 100) / 100,
    opened_at: (t.openedAt || t.createdAt)?.toISOString?.() || '',
    comment: '',
  }
}

// GET /api/v1/positions/?account_id=&status=open
router.get('/positions', jwtAuth, async (req, res) => {
  try {
    const account = await ownedAccount(req.user._id, req.query.account_id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')

    const trades = await Trade.find({ tradingAccountId: account._id, status: 'OPEN' })
      .sort({ openedAt: -1 })
    res.json(trades.map(positionJson))
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// Loads an OPEN trade and asserts the caller owns the account holding it.
async function ownedOpenTrade(userId, tradeId) {
  let trade
  try {
    trade = await Trade.findById(String(tradeId))
  } catch {
    return null
  }
  if (!trade || trade.status !== 'OPEN') return null
  const account = await ownedAccount(userId, trade.tradingAccountId)
  return account ? { trade, account } : null
}

// PUT /api/v1/positions/:id — {stop_loss?|null, take_profit?|null}
//
// Only the keys actually PRESENT in the body are applied; an explicit null
// clears that bracket. This is what lets the chart drag one line without
// silently reverting the other from a stale snapshot.
router.put('/positions/:id', jwtAuth, async (req, res) => {
  try {
    const found = await ownedOpenTrade(req.user._id, req.params.id)
    if (!found) return fail(res, 404, 'Open position not found')
    const { trade } = found

    const body = req.body || {}
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k)
    if (!has('stop_loss') && !has('take_profit')) return fail(res, 400, 'Nothing to update')

    const q = liveQuote(trade.symbol)

    // Reject a bracket on the wrong side of the market — the server would
    // otherwise trigger it on the very next tick, which reads as an instant
    // unexplained close.
    const check = (level, kind) => {
      if (level == null) return null
      if (!(level > 0)) return `${kind} must be greater than 0`
      if (!q) return null
      const ref = trade.side === 'BUY' ? q.bid : q.ask
      if (trade.side === 'BUY') {
        if (kind === 'Stop loss' && level >= ref) return 'Stop loss must be below the current price for a BUY'
        if (kind === 'Take profit' && level <= ref) return 'Take profit must be above the current price for a BUY'
      } else {
        if (kind === 'Stop loss' && level <= ref) return 'Stop loss must be above the current price for a SELL'
        if (kind === 'Take profit' && level >= ref) return 'Take profit must be below the current price for a SELL'
      }
      return null
    }

    if (has('stop_loss')) {
      const v = body.stop_loss === null ? null : Number(body.stop_loss)
      const err = check(v, 'Stop loss')
      if (err) return fail(res, 400, err)
      trade.stopLoss = v
      trade.sl = v
    }
    if (has('take_profit')) {
      const v = body.take_profit === null ? null : Number(body.take_profit)
      const err = check(v, 'Take profit')
      if (err) return fail(res, 400, err)
      trade.takeProfit = v
      trade.tp = v
    }

    await trade.save()
    res.json({ message: 'Position updated', ...positionJson(trade) })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/positions/:id/close — {} for a full close, {lots} for partial.
router.post('/positions/:id/close', jwtAuth, async (req, res) => {
  try {
    const found = await ownedOpenTrade(req.user._id, req.params.id)
    if (!found) return fail(res, 404, 'Open position not found')
    const { trade } = found

    // A closed market cannot be traded on, in either direction.
    //
    // Opening was already guarded on every path; closing was not guarded here,
    // and this is the path the desktop terminal and the mobile app both use.
    // The cached quote does not disappear when the week ends - it just stops
    // moving - so a close on Saturday would have filled at Friday's price,
    // hours after the market last agreed to it. The web route
    // (routes/trade.js) has always refused this; /api/v1 now says the same.
    if (!isMarketOpen(trade.symbol)) {
      return fail(res, 400, marketClosedReason(trade.symbol) ||
        `Market is closed for ${trade.symbol}.`)
    }

    const q = liveQuote(trade.symbol)
    if (!q) return fail(res, 503, `No live price for ${trade.symbol}. Please try again.`)

    const askedLots = Number(req.body?.lots)
    const isPartial = Number.isFinite(askedLots) && askedLots > 0 && askedLots < trade.quantity

    if (!isPartial) {
      const result = await tradeEngine.closeTrade(trade._id, q.bid, q.ask, 'USER')
      return res.json({
        message: 'Position closed',
        id: String(trade._id),
        close_price: result.trade.closePrice,
        profit: Math.round(result.realizedPnl * 100) / 100,
      })
    }

    // ---- Partial close ----
    // The same 3-minute minimum hold the full close enforces; applying it here
    // too stops a partial being used to sidestep the rule.
    const heldMs = Date.now() - new Date(trade.openedAt || trade.createdAt).getTime()
    if (heldMs < 3 * 60 * 1000) {
      const wait = Math.ceil((3 * 60 * 1000 - heldMs) / 1000)
      return fail(res, 400, `Trade cannot be closed before 3 minutes. Please wait ${wait} seconds.`)
    }

    const closePrice = trade.side === 'BUY' ? q.bid : q.ask
    const share = askedLots / trade.quantity
    const rawPnl = tradeEngine.calculatePnl(
      trade.side, trade.openPrice, closePrice, askedLots, trade.contractSize, trade.symbol
    )
    const swapShare = (trade.swap || 0) * share
    const realized = rawPnl - swapShare

    // Book the closed slice as its own CLOSED trade so history and reporting
    // see a real fill rather than a position that silently shrank.
    const sliceId = await Trade.generateTradeId()
    await Trade.create({
      userId: trade.userId,
      tradingAccountId: trade.tradingAccountId,
      accountType: trade.accountType,
      isChallengeAccount: trade.isChallengeAccount,
      tradeId: sliceId,
      symbol: trade.symbol,
      segment: trade.segment,
      side: trade.side,
      orderType: 'MARKET',
      quantity: askedLots,
      openPrice: trade.openPrice,
      closePrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      marginUsed: (trade.marginUsed || 0) * share,
      leverage: trade.leverage,
      contractSize: trade.contractSize,
      spread: trade.spread,
      commission: 0,                       // already charged on the parent open
      swap: swapShare,
      realizedPnl: realized,
      status: 'CLOSED',
      closedBy: 'USER',
      openedAt: trade.openedAt,
      closedAt: new Date(),
    })

    // Shrink the survivor, releasing its share of the margin and swap.
    trade.quantity = Math.round((trade.quantity - askedLots) * 100) / 100
    trade.marginUsed = (trade.marginUsed || 0) * (1 - share)
    trade.swap = (trade.swap || 0) - swapShare
    await trade.save()

    // Same balance-then-credit waterfall the full close applies.
    const account = await TradingAccount.findById(trade.tradingAccountId)
    if (realized >= 0) {
      account.balance += realized
    } else {
      const loss = Math.abs(realized)
      if (account.balance >= loss) {
        account.balance -= loss
      } else {
        const remaining = loss - account.balance
        account.balance = 0
        account.credit = Math.max(0, (account.credit || 0) - remaining)
      }
    }
    await account.save()

    res.json({
      message: `Closed ${askedLots} of ${askedLots + trade.quantity} lots`,
      id: String(trade._id),
      close_price: closePrice,
      profit: Math.round(realized * 100) / 100,
      remaining_lots: trade.quantity,
    })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

/* ──────────────────────  pending orders  ────────────────────── */

// Lot size off the request, in the spellings the clients use.
function lotsFor(body) {
  const n = Number(body?.lots ?? body?.volume ?? body?.quantity)
  if (!Number.isFinite(n) || n <= 0) {
    const e = new Error('lots must be greater than 0')
    e.status = 400
    throw e
  }
  return n
}

const ORDER_TYPE = {
  'buy:limit': 'BUY_LIMIT',
  'buy:stop': 'BUY_STOP',
  'sell:limit': 'SELL_LIMIT',
  'sell:stop': 'SELL_STOP',
}

function orderJson(t) {
  return {
    id: String(t._id),
    ticket: t.tradeId || '',
    symbol: t.symbol,
    order_type: t.orderType.endsWith('_LIMIT') ? 'limit' : 'stop',
    side: t.side.toLowerCase(),
    lots: t.quantity,
    price: t.pendingPrice ?? t.openPrice,
    stop_loss: t.sl ?? t.stopLoss ?? 0,
    take_profit: t.tp ?? t.takeProfit ?? 0,
    created_at: (t.createdAt)?.toISOString?.() || '',
    comment: '',
    status: 'pending',
  }
}

// GET /api/v1/orders/?account_id=&status=pending
router.get('/orders', jwtAuth, async (req, res) => {
  try {
    const account = await ownedAccount(req.user._id, req.query.account_id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')

    const orders = await Trade.find({ tradingAccountId: account._id, status: 'PENDING' })
      .sort({ createdAt: -1 })
    res.json(orders.map(orderJson))
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/orders/ — place a limit/stop order at a price the trader chose.
//
// Deliberately does NOT go through tradeEngine.openTrade: that helper derives
// pendingPrice from the CURRENT market quote, so every pending order would sit
// at spot instead of the requested level.
router.post('/orders', jwtAuth, async (req, res) => {
  try {
    const body = req.body || {}
    const account = await ownedAccount(req.user._id, body.account_id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')
    if (account.status !== 'Active') return fail(res, 403, `Account is ${account.status}`)
    if (!req.user.kycApproved) {
      return fail(res, 403, 'Complete KYC verification and wait for admin approval before trading.')
    }

    const symbol = String(body.symbol || '').toUpperCase()
    if (!SUPPORTED_SYMBOLS.includes(symbol)) return fail(res, 404, `Unknown symbol ${symbol}`)

    const side = String(body.side || '').toLowerCase()
    const type = String(body.order_type || '').toLowerCase()
    if (side !== 'buy' && side !== 'sell') return fail(res, 400, 'side must be buy or sell')

    // A market order fills now; the rest of this handler arms a PENDING one and
    // needs a price to arm it at. The app's Buy/Sell buttons post here with
    // order_type "market", so without this branch the one action a trader takes
    // most often answered 400 and no position could be opened from the app at
    // all. Same tradeEngine.openTrade the website's /api/trade/open uses, so
    // spread, margin, commission and the market-hours rule are identical.
    if (type === 'market') {
      if (!isMarketOpen(symbol)) {
        return fail(res, 400, marketClosedReason(symbol) || `${symbol} is closed for trading right now`)
      }
      const quote = liveQuote(symbol)
      if (!quote || !(quote.bid > 0) || !(quote.ask > 0)) {
        return fail(res, 400, `No live price for ${symbol} right now`)
      }

      const trade = await tradeEngine.openTrade(
        req.user._id,
        String(account._id),
        symbol,
        resolveTradeSegment(symbol),
        side.toUpperCase(),
        'MARKET',
        lotsFor(body),
        quote.bid,
        quote.ask,
        Number.isFinite(Number(body.stop_loss)) ? Number(body.stop_loss) : null,
        Number.isFinite(Number(body.take_profit)) ? Number(body.take_profit) : null,
        body.leverage || null,
        null,
      )
      return res.json(positionJson(trade))
    }

    const orderType = ORDER_TYPE[`${side}:${type}`]
    if (!orderType) return fail(res, 400, 'order_type must be market, limit or stop')

    const lots = Number(body.lots)
    if (!Number.isFinite(lots) || lots <= 0) return fail(res, 400, 'lots must be greater than 0')

    const price = Number(body.price)
    if (!Number.isFinite(price) || price <= 0) return fail(res, 400, 'price must be greater than 0')

    // A limit must sit on the far side of the market and a stop beyond it;
    // otherwise the order fills on the next tick and is really a market order.
    const q = liveQuote(symbol)
    if (q) {
      const ref = side === 'buy' ? q.ask : q.bid
      const wrong =
        (side === 'buy' && type === 'limit' && price >= ref) ||
        (side === 'buy' && type === 'stop' && price <= ref) ||
        (side === 'sell' && type === 'limit' && price <= ref) ||
        (side === 'sell' && type === 'stop' && price >= ref)
      if (wrong) {
        return fail(res, 400,
          `A ${side} ${type} must be ${type === 'limit'
            ? (side === 'buy' ? 'below' : 'above')
            : (side === 'buy' ? 'above' : 'below')} the current price (${ref}).`)
      }
    }

    const contractSize = symbolContractSize(symbol)
    const leverageNum = parseInt(String(account.leverage).replace('1:', ''), 10) || 100
    const marginUsed = tradeEngine.calculateMargin(lots, price, `1:${leverageNum}`, contractSize, symbol)

    const sl = Number(body.stop_loss) > 0 ? Number(body.stop_loss) : null
    const tp = Number(body.take_profit) > 0 ? Number(body.take_profit) : null

    // The trigger price is what this order will open at, so that — not today's
    // market — is what its brackets have to sit around. A stop on the wrong side
    // of it survives until the order fills and is then hit on the sweep's next
    // look, so the position appears and disappears within minutes of each other.
    const bracketErr = validatePendingBrackets(side, sl, tp, price)
    if (bracketErr) return fail(res, 400, bracketErr)

    const tradeId = await Trade.generateTradeId()
    const order = await Trade.create({
      userId: req.user._id,
      tradingAccountId: account._id,
      tradeId,
      symbol,
      segment: resolveTradeSegment(symbol),
      side: side.toUpperCase(),
      orderType,
      quantity: lots,
      openPrice: price,
      pendingPrice: price,
      stopLoss: sl,
      sl,
      takeProfit: tp,
      tp,
      marginUsed,
      leverage: leverageNum,
      contractSize,
      status: 'PENDING',
    })

    res.json({ message: 'Pending order placed', ...orderJson(order) })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

async function ownedPendingOrder(userId, orderId) {
  let order
  try {
    order = await Trade.findById(String(orderId))
  } catch {
    return null
  }
  if (!order || order.status !== 'PENDING') return null
  const account = await ownedAccount(userId, order.tradingAccountId)
  return account ? order : null
}

// PUT /api/v1/orders/:id — amend only the legs the caller actually sent.
router.put('/orders/:id', jwtAuth, async (req, res) => {
  try {
    const order = await ownedPendingOrder(req.user._id, req.params.id)
    if (!order) return fail(res, 404, 'Pending order not found')

    const body = req.body || {}
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k)

    if (has('price')) {
      const p = Number(body.price)
      if (!Number.isFinite(p) || p <= 0) return fail(res, 400, 'price must be greater than 0')
      order.openPrice = p
      order.pendingPrice = p
    }
    if (has('lots')) {
      const l = Number(body.lots)
      if (!Number.isFinite(l) || l <= 0) return fail(res, 400, 'lots must be greater than 0')
      order.quantity = l
    }
    if (has('stop_loss')) {
      const v = body.stop_loss === null ? null : Number(body.stop_loss)
      order.stopLoss = v
      order.sl = v
    }
    if (has('take_profit')) {
      const v = body.take_profit === null ? null : Number(body.take_profit)
      order.takeProfit = v
      order.tp = v
    }

    // Price or size changed ⇒ the reserved margin is stale.
    if (has('price') || has('lots')) {
      order.marginUsed = tradeEngine.calculateMargin(
        order.quantity, order.openPrice, `1:${order.leverage}`, order.contractSize, order.symbol
      )
    }

    await order.save()
    res.json({ message: 'Order updated', ...orderJson(order) })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

// DELETE /api/v1/orders/:id
router.delete('/orders/:id', jwtAuth, async (req, res) => {
  try {
    const order = await ownedPendingOrder(req.user._id, req.params.id)
    if (!order) return fail(res, 404, 'Pending order not found')

    order.status = 'CANCELLED'
    await order.save()
    res.json({ message: 'Order cancelled', id: String(order._id) })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

/* ─────────────────────  history + ledger  ───────────────────── */

// GET /api/v1/portfolio/trades?account_id=&per_page=
router.get('/portfolio/trades', jwtAuth, async (req, res) => {
  try {
    const account = await ownedAccount(req.user._id, req.query.account_id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')

    const perPage = Math.min(500, Math.max(1, parseInt(req.query.per_page, 10) || 100))
    const trades = await Trade.find({ tradingAccountId: account._id, status: 'CLOSED' })
      .sort({ closedAt: -1 })
      .limit(perPage)

    res.json({
      items: trades.map(t => ({
        id: String(t._id),
        ticket: t.tradeId || '',
        symbol: t.symbol,
        side: t.side,
        lots: t.quantity,
        open_price: t.openPrice,
        close_price: t.closePrice,
        profit: t.realizedPnl ?? 0,
        swap: t.swap || 0,
        commission: t.commission || 0,
        opened_at: (t.openedAt || t.createdAt)?.toISOString?.() || '',
        closed_at: t.closedAt?.toISOString?.() || '',
        close_reason: t.closedBy || 'USER',
      })),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/wallet/transactions?account_id= — the account's money movements.
router.get('/wallet/transactions', jwtAuth, async (req, res) => {
  try {
    const account = await ownedAccount(req.user._id, req.query.account_id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')

    const txns = await Transaction.find({
      userId: req.user._id,
      $or: [
        { tradingAccountId: account._id },
        { toTradingAccountId: account._id },
        { fromTradingAccountId: account._id },
      ],
    }).sort({ createdAt: -1 }).limit(200)

    res.json({
      items: txns.map(t => ({
        id: String(t._id),
        type: t.type,
        method: t.paymentMethod || 'Internal',
        description: t.description || '',
        currency: 'USD',
        // An outbound transfer is a debit on this account; the model stores
        // every amount as a positive magnitude, so the sign is derived here.
        amount: String(t.fromTradingAccountId) === String(account._id) ||
                t.type === 'Transfer_From_Account' || t.type === 'Account_Transfer_Out' ||
                t.type === 'Withdrawal' || t.type === 'Credit_Out'
          ? -Math.abs(t.amount)
          : Math.abs(t.amount),
        created_at: t.createdAt?.toISOString?.() || '',
        status: t.status,
      })),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

/* ─────────────────────────  wallet  ───────────────────────── */

// The main wallet is the Wallet collection, and only that one.
//
// Two stores of "main wallet balance" exist in this codebase and they do not
// agree. Deposits credit Wallet, the website's wallet page reads Wallet, and
// the transfer a web trader actually performs (POST /api/trading-accounts/:id
// /transfer) moves Wallet — while the older /api/wallet-transfer routes move
// User.walletBalance, which nothing on the site displays. Reading the other one
// here would show a trader $0.00 next to a funded wallet, so this follows the
// balance the platform actually spends.
async function mainWalletBalance(userId) {
  const w = await Wallet.findOne({ userId })
  return w ? w.balance || 0 : 0
}

const isDemoAccount = (a) => !!(a.isDemo || a.accountTypeId?.isDemo)
const money = (n) => Math.round((Number(n) || 0) * 100) / 100

// Equity and margin for one account, by the same arithmetic as the terminal's
// own footer: equity = balance + credit + floating P&L, free = equity - used.
async function accountFunds(account) {
  const open = await Trade.find({ tradingAccountId: account._id, status: 'OPEN' })
  let used = 0
  let floating = 0
  for (const t of open) {
    used += t.marginUsed || 0
    const q = liveQuote(t.symbol)
    if (q) floating += tradeEngine.calculateFloatingPnl(t, q.bid, q.ask)
  }
  const equity = (account.balance || 0) + (account.credit || 0) + floating
  return { used, equity, free: equity - used }
}

// What may actually leave an account: its free margin, but never more than the
// cash in it. Credit is the platform's money — it can support a position and it
// cannot be withdrawn.
const withdrawable = (account, funds) =>
  money(Math.max(0, Math.min(funds.free, account.balance || 0)))

// GET /api/v1/wallet/summary — the main wallet, and the accounts money can move
// between. Demo accounts are deliberately absent: their balance is play money
// the platform mints, and it must never find a route into a real wallet.
router.get('/wallet/summary', jwtAuth, async (req, res) => {
  try {
    const accounts = await TradingAccount.find({
      userId: req.user._id,
      status: 'Active',
    }).populate('accountTypeId', 'name isDemo minDeposit').sort({ createdAt: -1 })

    const live = []
    for (const a of accounts) {
      if (isDemoAccount(a)) continue
      const f = await accountFunds(a)
      live.push({
        id: String(a._id),
        account_number: a.accountId,
        currency: 'USD',
        balance: money(a.balance),
        credit: money(a.credit),
        margin_used: money(f.used),
        equity: money(f.equity),
        free_margin: withdrawable(a, f),
      })
    }

    res.json({
      main_wallet_balance: money(await mainWalletBalance(req.user._id)),
      live_accounts: live,
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/wallet/transfer-main-to-trading — {to_account_id, amount}
router.post('/wallet/transfer-main-to-trading', jwtAuth, async (req, res) => {
  try {
    const amount = money(req.body?.amount)
    if (!(amount > 0)) return fail(res, 400, 'amount must be greater than 0')

    const account = await ownedAccount(req.user._id, req.body?.to_account_id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')
    if (isDemoAccount(account)) {
      return fail(res, 400, 'Wallet transfers are not available on a demo account')
    }
    if (account.status !== 'Active') return fail(res, 400, `Account is ${account.status}`)

    // The account type's minimum applies to the first money in, exactly as it
    // does on the website.
    const min = account.accountTypeId?.minDeposit
    if (!(account.balance > 0) && min > 0 && amount < min) {
      return fail(res, 400, `Minimum first deposit for the ` +
        `${account.accountTypeId?.name || 'this'} account is $${min}`)
    }

    // The debit is CONDITIONAL and atomic.
    //
    // Read-the-balance-then-write-it-back is what the rest of the platform does,
    // and two transfers landing together lose money that way: both read the same
    // balance, both write their own result, and one debit disappears. Making the
    // balance test the update's own filter means the check and the deduction
    // cannot be separated by another write.
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.user._id, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { new: true }
    )
    if (!wallet) return fail(res, 400, 'Insufficient balance in the main wallet')

    let credited
    try {
      credited = await TradingAccount.findOneAndUpdate(
        { _id: account._id, userId: req.user._id, status: 'Active' },
        { $inc: { balance: amount } },
        { new: true }
      )
      if (!credited) throw new Error('The trading account could not be credited')
    } catch (e) {
      // Put it back. The wallet has already been debited at this point, and
      // returning an error without this would simply delete the money.
      await Wallet.updateOne({ _id: wallet._id }, { $inc: { balance: amount } })
      return fail(res, 500, e.message)
    }

    // The same ledger row the website writes, so one transfer reads identically
    // in the web wallet history and in the terminal's Transactions tab.
    await Transaction.create({
      userId: req.user._id,
      type: 'Transfer_To_Account',
      amount,
      paymentMethod: 'Internal',
      tradingAccountId: account._id,
      tradingAccountName: account.accountId,
      description: 'Main wallet to trading account',
      status: 'Completed',
      transactionRef: `TRF${Date.now()}`,
    })

    res.json({
      message: `Transferred $${amount.toFixed(2)} to ${account.accountId}`,
      main_wallet_balance: money(wallet.balance),
      account_balance: money(credited.balance),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/wallet/transfer-trading-to-main — {from_account_id, amount}
router.post('/wallet/transfer-trading-to-main', jwtAuth, async (req, res) => {
  try {
    const amount = money(req.body?.amount)
    if (!(amount > 0)) return fail(res, 400, 'amount must be greater than 0')

    const account = await ownedAccount(req.user._id, req.body?.from_account_id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')
    if (isDemoAccount(account)) {
      return fail(res, 400, 'Wallet transfers are not available on a demo account')
    }
    if (account.status !== 'Active') return fail(res, 400, `Account is ${account.status}`)

    // Free margin, not balance: money backing an open position cannot leave, or
    // the next tick against the trader closes it out for want of margin.
    const funds = await accountFunds(account)
    const max = withdrawable(account, funds)
    if (amount > max) {
      return fail(res, 400, `Only $${max.toFixed(2)} is free to move — the rest is ` +
        `margin on open positions.`)
    }

    const debited = await TradingAccount.findOneAndUpdate(
      { _id: account._id, userId: req.user._id, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { new: true }
    )
    if (!debited) return fail(res, 400, 'Insufficient balance on the trading account')

    let wallet
    try {
      // upsert: a user who has never had a wallet row still has one after their
      // first withdrawal from an account.
      wallet = await Wallet.findOneAndUpdate(
        { userId: req.user._id },
        { $inc: { balance: amount } },
        { new: true, upsert: true }
      )
    } catch (e) {
      await TradingAccount.updateOne({ _id: account._id }, { $inc: { balance: amount } })
      return fail(res, 500, e.message)
    }

    await Transaction.create({
      userId: req.user._id,
      type: 'Transfer_From_Account',
      amount,
      paymentMethod: 'Internal',
      tradingAccountId: account._id,
      tradingAccountName: account.accountId,
      description: 'Trading account to main wallet',
      status: 'Completed',
      transactionRef: `TRF${Date.now()}`,
    })

    res.json({
      message: `Transferred $${amount.toFixed(2)} to the main wallet`,
      main_wallet_balance: money(wallet.balance),
      account_balance: money(debited.balance),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

/* ────────────────  social: masters and the money following them  ──────────── */

// What this platform actually runs is COPY TRADING, not a pooled PAMM fund.
//
// The app was written against a backend with pooled allocations - money leaves
// the wallet, a sub-account is created, units are held. Here a follower keeps
// their own balance and their own account, and a master's fills are mirrored
// into it at a size the follower chose. So "invest 500 with this manager" maps
// onto "copy this manager, sized at 500", and "withdraw" onto "stop copying".
// The numbers below are all real - followers, P/L, commission - but nothing
// here pools capital, and the naming in the responses is the app's, not ours.

const masterJson = (m) => ({
  id: String(m._id),
  manager_name: m.displayName ||
    [m.userId?.firstName, m.userId?.lastName].filter(Boolean).join(' ') || 'Manager',
  master_type: 'COPY',
  description: m.description || '',
  // The follower sets their own size, so there is no house minimum to quote.
  min_investment: 0,
  performance_fee_pct: m.approvedCommissionPercentage ?? m.requestedCommissionPercentage ?? 0,
  active_investors: m.stats?.activeFollowers || 0,
  total_investors: m.stats?.totalFollowers || 0,
  total_trades: m.stats?.totalTrades || 0,
  win_rate_pct: money(m.stats?.winRate),
  total_profit_generated: money(m.stats?.totalProfitGenerated),
  // Neither of these is tracked per-master yet: a real return figure needs an
  // equity curve, and a drawdown needs its low-water mark. Sending an invented
  // number to a screen that ranks managers by it would be worse than a zero.
  total_return_pct: 0,
  max_drawdown_pct: 0,
})

// GET /api/v1/social/mamm-pamm  (alias: /social/masters) - the managers on offer.
const listMasters = async (req, res) => {
  try {
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 50))
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const masters = await MasterTrader.find({ status: 'ACTIVE' })
      .populate('userId', 'firstName lastName')
      .sort({ 'stats.activeFollowers': -1, createdAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
    res.json({ items: masters.map(masterJson), page, per_page: perPage })
  } catch (e) {
    fail(res, 500, e.message)
  }
}
router.get('/social/mamm-pamm', jwtAuth, listMasters)
router.get('/social/masters', jwtAuth, listMasters)

// One follower row, in the shape the allocations screen reads.
const allocationJson = (f) => {
  const profit = f.stats?.totalProfit || 0
  const loss = f.stats?.totalLoss || 0
  const pnl = profit - loss
  const size = f.copyValue || 0
  return {
    id: String(f._id),
    master_id: String(f.masterId?._id || f.masterId),
    manager_name: f.masterId?.displayName || 'Manager',
    master_type: 'COPY',
    status: f.status,
    copy_mode: f.copyMode,
    allocation_amount: money(size),
    current_value: money(size + pnl),
    total_pnl: money(pnl),
    total_pnl_pct: size > 0 ? money((pnl / size) * 100) : 0,
    copied_trades: f.stats?.totalCopiedTrades || 0,
    open_copied_trades: f.stats?.activeCopiedTrades || 0,
    commission_paid: money(f.stats?.totalCommissionPaid),
    joined_at: f.startedAt?.toISOString?.() || f.createdAt?.toISOString?.() || '',
  }
}

// GET /api/v1/social/my-allocations  (aliases: /my-copies, /subscriptions)
const listAllocations = async (req, res) => {
  try {
    const rows = await CopyFollower.find({
      followerId: req.user._id,
      status: { $in: ['ACTIVE', 'PAUSED'] },
    }).populate('masterId', 'displayName approvedCommissionPercentage').sort({ createdAt: -1 })

    const items = rows.map(allocationJson)
    const invested = items.reduce((t, i) => t + i.allocation_amount, 0)
    const value = items.reduce((t, i) => t + i.current_value, 0)
    const pnl = items.reduce((t, i) => t + i.total_pnl, 0)
    res.json({
      items,
      summary: {
        total_invested: money(invested),
        total_current_value: money(value),
        total_pnl: money(pnl),
        overall_pnl_pct: invested > 0 ? money((pnl / invested) * 100) : 0,
      },
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
}
router.get('/social/my-allocations', jwtAuth, listAllocations)
router.get('/social/my-copies', jwtAuth, listAllocations)
router.get('/social/subscriptions', jwtAuth, listAllocations)

// POST /api/v1/social/mamm-pamm/:masterId/invest?amount=&account_id=
//
// Starts copying, sized at `amount`. No money moves: the follower trades their
// own account, and that is what the size means here.
router.post('/social/mamm-pamm/:masterId/invest', jwtAuth, async (req, res) => {
  try {
    const amount = money(req.query.amount ?? req.body?.amount)
    if (!(amount > 0)) return fail(res, 400, 'amount must be greater than 0')

    const master = await MasterTrader.findById(String(req.params.masterId))
    if (!master || master.status !== 'ACTIVE') return fail(res, 404, 'Manager not found')

    // The follower's own account carries the copied trades. Named explicitly
    // when the app knows it, otherwise their first active live account.
    let account = req.query.account_id
      ? await ownedAccount(req.user._id, req.query.account_id)
      : null
    if (!account) {
      const own = await TradingAccount.find({ userId: req.user._id, status: 'Active' })
        .populate('accountTypeId', 'isDemo').sort({ createdAt: 1 })
      account = own.find(a => !(a.isDemo || a.accountTypeId?.isDemo)) || null
    }
    if (!account) return fail(res, 400, 'No live trading account to copy into')
    if (String(master.tradingAccountId) === String(account._id)) {
      return fail(res, 400, 'A manager cannot copy their own account')
    }

    const existing = await CopyFollower.findOne({
      followerId: req.user._id,
      masterId: master._id,
      status: { $in: ['ACTIVE', 'PAUSED'] },
    })
    if (existing) {
      // Already following: treat a second "invest" as a resize rather than a
      // duplicate subscription, which is what the screen's button means.
      existing.copyValue = amount
      existing.status = 'ACTIVE'
      await existing.save()
      return res.json({ message: 'Allocation updated', ...allocationJson(existing) })
    }

    const follower = await CopyFollower.create({
      followerId: req.user._id,
      masterId: master._id,
      followerAccountId: account._id,
      status: 'ACTIVE',
      copyMode: 'BALANCE_BASED',
      copyValue: amount,
      startedAt: new Date(),
    })
    await MasterTrader.updateOne({ _id: master._id }, {
      $inc: { 'stats.totalFollowers': 1, 'stats.activeFollowers': 1 },
    })
    res.json({ message: 'Copying started', ...allocationJson(follower) })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

// DELETE /api/v1/social/mamm-pamm/:masterId/withdraw - stop copying.
//
// The app sends the ALLOCATION id here, not the master's, so both are accepted.
// Positions already copied stay open and belong to the follower; this only
// stops new ones being mirrored.
router.delete('/social/mamm-pamm/:masterId/withdraw', jwtAuth, async (req, res) => {
  try {
    const id = String(req.params.masterId)
    let row = null
    try { row = await CopyFollower.findOne({ _id: id, followerId: req.user._id }) } catch { row = null }
    if (!row) {
      row = await CopyFollower.findOne({
        followerId: req.user._id, masterId: id, status: { $in: ['ACTIVE', 'PAUSED'] },
      })
    }
    if (!row) return fail(res, 404, 'Allocation not found')
    if (row.status === 'STOPPED') return res.json({ message: 'Already stopped' })

    row.status = 'STOPPED'
    row.stoppedAt = new Date()
    await row.save()
    await MasterTrader.updateOne({ _id: row.masterId }, {
      $inc: { 'stats.activeFollowers': -1 },
    })
    res.json({ message: 'Copying stopped', id: String(row._id) })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

// GET /api/v1/social/masters/eligibility - may this user offer themselves as one.
router.get('/social/masters/eligibility', jwtAuth, async (req, res) => {
  try {
    const existing = await MasterTrader.findOne({ userId: req.user._id })
    const user = await User.findById(req.user._id).select('kycApproved')
    res.json({
      is_master: !!existing && existing.status === 'ACTIVE',
      status: existing?.status || 'NONE',
      eligible: !!user?.kycApproved && !existing,
      requirements: {
        kyc_approved: !!user?.kycApproved,
        already_applied: !!existing,
      },
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/social/master-performance - the signed-in user AS a manager.
router.get('/social/master-performance', jwtAuth, async (req, res) => {
  try {
    const m = await MasterTrader.findOne({ userId: req.user._id })
      .populate('userId', 'firstName lastName')
    if (!m) return res.json({ is_master: false })
    res.json({
      is_master: true,
      status: m.status,
      ...masterJson(m),
      pending_commission: money(m.pendingCommission),
      total_commission_earned: money(m.totalCommissionEarned),
      total_commission_withdrawn: money(m.totalCommissionWithdrawn),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/social/master-investors - who is copying the signed-in manager.
router.get('/social/master-investors', jwtAuth, async (req, res) => {
  try {
    const m = await MasterTrader.findOne({ userId: req.user._id })
    if (!m) return res.json({ items: [] })
    const rows = await CopyFollower.find({
      masterId: m._id, status: { $in: ['ACTIVE', 'PAUSED'] },
    }).populate('followerId', 'firstName lastName').sort({ createdAt: -1 })
    res.json({
      items: rows.map(f => ({
        id: String(f._id),
        investor_name: [f.followerId?.firstName, f.followerId?.lastName]
          .filter(Boolean).join(' ') || 'Investor',
        status: f.status,
        allocation_amount: money(f.copyValue),
        total_pnl: money((f.stats?.totalProfit || 0) - (f.stats?.totalLoss || 0)),
        copied_trades: f.stats?.totalCopiedTrades || 0,
        joined_at: f.startedAt?.toISOString?.() || '',
      })),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/social/follow-requests - always empty, and that is the truth.
//
// Following here needs no approval: a follower subscribes and copying starts.
// The app has a screen for managers to accept or decline requests; there are
// none to show, and answering 404 would put a red error on a screen that is
// simply not part of this platform's flow.
router.get('/social/follow-requests', jwtAuth, (_req, res) => res.json({ items: [] }))

/* ─────────────────────────  profile  ───────────────────────── */

const profileJson = (u) => ({
  id: String(u._id),
  first_name: u.firstName || '',
  last_name: u.lastName || '',
  full_name: [u.firstName, u.lastName].filter(Boolean).join(' '),
  email: u.email || '',
  phone: u.phone || '',
  country_code: u.countryCode || '',
  profile_image: u.profileImage || '',
  kyc_approved: !!u.kycApproved,
  is_ib: !!u.isIB,
  ib_status: u.ibStatus || 'NONE',
  referral_code: u.referralCode || '',
  wallet_balance: money(u.walletBalance),
  created_at: u.createdAt?.toISOString?.() || '',
})

// GET /api/v1/profile
router.get('/profile', jwtAuth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id)
    if (!u) return fail(res, 404, 'User not found')
    res.json(profileJson(u))
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// PUT /api/v1/profile - only the fields a trader owns.
//
// Email is deliberately NOT editable here: it is the sign-in identity and the
// address every notice goes to, so changing it belongs behind a verification
// flow, not a profile form.
router.put('/profile', jwtAuth, async (req, res) => {
  try {
    const b = req.body || {}
    const set = {}
    const take = (from, to) => {
      const v = b[from] ?? b[to]
      if (typeof v === 'string' && v.trim()) set[to] = v.trim()
    }
    take('first_name', 'firstName')
    take('last_name', 'lastName')
    take('phone', 'phone')
    take('country_code', 'countryCode')
    take('profile_image', 'profileImage')
    if (!Object.keys(set).length) return fail(res, 400, 'Nothing to update')

    const u = await User.findByIdAndUpdate(req.user._id, { $set: set }, { new: true })
    if (!u) return fail(res, 404, 'User not found')
    res.json(profileJson(u))
  } catch (e) {
    fail(res, 400, e.message)
  }
})

// GET /api/v1/profile/documents - what KYC holds for this user.
router.get('/profile/documents', jwtAuth, async (req, res) => {
  try {
    const k = await KYC.findOne({ userId: req.user._id }).sort({ createdAt: -1 })
    if (!k) return res.json({ status: 'NOT_SUBMITTED', items: [] })
    const docs = []
    for (const [key, val] of Object.entries(k.toObject())) {
      if (val && typeof val === 'object' && (val.url || val.path || val.fileUrl)) {
        docs.push({
          type: key,
          url: val.url || val.path || val.fileUrl,
          status: val.status || k.status || 'PENDING',
          uploaded_at: val.uploadedAt?.toISOString?.() || '',
        })
      }
    }
    res.json({ status: k.status || 'PENDING', items: docs })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/profile/push-token  {token, platform}
router.post('/profile/push-token', jwtAuth, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    if (!token) return fail(res, 400, 'token is required')
    const platform = ['ios', 'android', 'web'].includes(req.body?.platform)
      ? req.body.platform : 'unknown'

    // One row per device: the same token re-registering updates in place rather
    // than stacking duplicates that would each get their own copy of every push.
    await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: { token } } })
    await User.updateOne({ _id: req.user._id },
      { $push: { pushTokens: { token, platform, updatedAt: new Date() } } })
    res.json({ message: 'Push token registered' })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

// DELETE /api/v1/profile/push-token  {token} - sign-out on that device.
router.delete('/profile/push-token', jwtAuth, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    if (!token) return fail(res, 400, 'token is required')
    await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: { token } } })
    res.json({ message: 'Push token removed' })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

/* ──────────────────  notifications and banners  ────────────────── */

// This platform has no notification store, and no banner store either - the
// website does not have these features, so there is nothing to mirror. They
// answer empty rather than 404 so the screens render "nothing here" instead of
// a red error, and so the day either feature exists the app needs no change.
router.get('/notifications', jwtAuth, (_req, res) => res.json({ items: [], unread: 0, page: 1, pages: 1 }))
router.post('/notifications/:id/read', jwtAuth, (_req, res) => res.json({ message: 'ok' }))
router.post('/notifications/read-all', jwtAuth, (_req, res) => res.json({ message: 'ok' }))
router.delete('/notifications/:id', jwtAuth, (_req, res) => res.json({ message: 'ok' }))
router.get('/banners', jwtAuth, (_req, res) => res.json({ items: [] }))
router.post('/banners/:id/click', jwtAuth, (_req, res) => res.json({ message: 'ok' }))

/* ─────────────────────────  instruments  ───────────────────────── */

// POST /api/v1/auth/investor-login — {account_number, password}
//
// The read-only sign-in an account owner hands to someone who should see the
// account but not touch it. The credential is the account's investorPassword,
// set by an admin — the same one the web's /trading-accounts/investor-login
// checks, so one password works on both.
//
// The session it issues is the owner's, marked `ro`, and pinned to this one
// account. Enforcement is in jwtAuth (utils/terminalAuth.js): every non-GET is
// refused there, so the restriction holds even if the request never goes near
// the app's UI.
router.post('/auth/investor-login', async (req, res) => {
  try {
    const accountNumber = String(req.body?.account_number || req.body?.accountId || '').trim()
    const password = String(req.body?.password || '')
    if (!accountNumber || !password) return fail(res, 400, 'Account number and password are required')

    const account = await TradingAccount.findOne({ accountId: accountNumber })
      .populate('userId', 'firstName email isBlocked isBanned')
      .populate('accountTypeId', 'name isDemo')

    // One message for "no such account" and "wrong password" alike — telling
    // them apart would turn this into an account-number oracle.
    const INVALID = 'Invalid account number or password'
    if (!account) return fail(res, 401, INVALID)
    if (!account.investorPassword || account.investorPassword !== password) {
      return fail(res, 401, INVALID)
    }

    const owner = account.userId
    if (!owner) return fail(res, 401, INVALID)
    if (owner.isBanned) return fail(res, 403, 'This account is banned')
    if (owner.isBlocked) return fail(res, 403, 'This account is blocked')

    // No refresh cookie is issued, and any existing one is cleared. An investor
    // session is deliberately short-lived; leaving a previous full session's
    // cookie in the jar would let /auth/refresh trade this read-only token for
    // an unrestricted one.
    res.clearCookie(REFRESH_COOKIE, { path: '/' })
    const accessToken = signAccessToken(owner._id, { ro: true, acct: String(account._id) })

    res.json({
      access_token: accessToken,
      token: accessToken,
      token_type: 'bearer',
      read_only: true,
      investor: true,
      account_id: String(account._id),
      name: owner.firstName,
      user: {
        id: String(owner._id),
        name: owner.firstName,
        full_name: owner.firstName,
        email: owner.email,
        kyc_approved: true,
        read_only: true,
      },
      account: {
        account_id: String(account._id),
        account_number: account.accountId,
        balance: account.balance,
        credit: account.credit,
        leverage: account.leverage,
        status: account.status,
        is_demo: !!(account.isDemo || account.accountTypeId?.isDemo),
        type: account.accountTypeId?.name || '',
      },
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

/* ─────────────────────  signup (OTP)  ───────────────────── */

// The app collects the whole form first, emails a code, then verifies with only
// {email, otp} — so the form has to be parked somewhere between the two calls.
// It waits on the OTP document (models/OTP.js pendingSignup) and the account is
// created only once the code checks out. Nothing is written to the users
// collection before verification, so an abandoned signup leaves nothing behind.

async function createSignupUser(payload) {
  const email = String(payload.email || '').trim().toLowerCase()

  let assignedAdmin = null, adminUrlSlug = null
  if (payload.adminSlug) {
    const admin = await Admin.findOne({ urlSlug: String(payload.adminSlug).toLowerCase(), status: 'ACTIVE' })
    if (admin) { assignedAdmin = admin._id; adminUrlSlug = admin.urlSlug }
  }

  let parentIBId = null, referredBy = null
  if (payload.referralCode) {
    const ib = await User.findOne({ referralCode: payload.referralCode, isIB: true, ibStatus: 'ACTIVE' })
    if (ib) { parentIBId = ib._id; referredBy = payload.referralCode }
  }

  const user = await User.create({
    firstName: payload.firstName || payload.first_name || payload.name || '',
    email,
    phone: payload.phone || '',
    countryCode: payload.countryCode || payload.country_code || '',
    password: payload.password,
    assignedAdmin,
    adminUrlSlug,
    parentIBId,
    referredBy,
    emailVerified: true,
  })

  if (assignedAdmin) await Admin.findByIdAndUpdate(assignedAdmin, { $inc: { 'stats.totalUsers': 1 } })

  const settings = await EmailSettings.findOne()
  sendTemplateEmail('welcome', email, {
    firstName: user.firstName,
    email: user.email,
    platformName: settings?.fromName || 'Vxness',
    loginUrl: 'https://vxness.in/user/login',
    supportEmail: settings?.fromEmail || 'support@vxness.in',
    year: new Date().getFullYear().toString(),
  })

  return user
}

async function issueSession(res, user) {
  const accessToken = signAccessToken(user._id)
  setRefreshCookie(res, await TerminalRefreshToken.issue(user._id))
  return {
    access_token: accessToken,
    token: accessToken,
    token_type: 'bearer',
    user_id: String(user._id),
    name: user.firstName,
    user: {
      id: String(user._id),
      name: user.firstName,
      full_name: user.firstName,
      email: user.email,
      kyc_approved: !!user.kycApproved,
    },
  }
}

// POST /api/v1/auth/register/start — the signup form; emails a code.
router.post('/auth/register/start', async (req, res) => {
  try {
    const body = req.body || {}
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!email || !password) return fail(res, 400, 'Email and password are required')

    if (await User.findOne({ email })) return fail(res, 400, 'An account with this email already exists')

    // OTP switched off platform-wide: create the account now and hand back a
    // session, so the app's verify step has nothing left to do.
    if (!(await isOTPEnabled())) {
      const user = await createSignupUser({ ...body, email, password })
      return res.json({ ...(await issueSession(res, user)), otp_required: false, message: 'Account created' })
    }

    const otp = generateOTP()
    const expiryMinutes = await getOTPExpiry()
    await OTP.deleteMany({ email, purpose: 'signup' })
    await OTP.create({
      email,
      otp,
      purpose: 'signup',
      expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
      pendingSignup: { ...body, email, password },
    })

    const settings = await EmailSettings.findOne()
    await sendTemplateEmail('email_verification', email, {
      otp,
      firstName: body.firstName || body.first_name || 'User',
      email,
      expiryMinutes: String(expiryMinutes),
      platformName: settings?.fromName || 'Vxness',
      supportEmail: settings?.fromEmail || 'support@vxness.in',
      year: new Date().getFullYear().toString(),
    })

    res.json({ otp_required: true, message: 'Verification code sent to your email' })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/auth/register/verify — {email, otp} → account + session.
router.post('/auth/register/verify', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const otp = String(req.body?.otp || '').trim()
    if (!email || !otp) return fail(res, 400, 'Email and code are required')

    const record = await OTP.findOne({ email, otp, purpose: 'signup' })
    if (!record) return fail(res, 400, 'Invalid verification code')
    if (record.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: record._id })
      return fail(res, 400, 'This code has expired — request a new one')
    }

    // Re-checked here, not only at start: two devices could run the flow
    // concurrently, and the unique index would otherwise surface as a 500.
    if (await User.findOne({ email })) {
      await OTP.deleteOne({ _id: record._id })
      return fail(res, 400, 'An account with this email already exists')
    }

    const payload = record.pendingSignup
    if (!payload) return fail(res, 400, 'Signup details expired — please start again')

    const user = await createSignupUser(payload)
    await OTP.deleteOne({ _id: record._id })

    res.json(await issueSession(res, user))
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/auth/register/resend — {email}
router.post('/auth/register/resend', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!email) return fail(res, 400, 'Email is required')

    const record = await OTP.findOne({ email, purpose: 'signup' })
    if (!record) return fail(res, 400, 'No signup in progress for this email')

    const otp = generateOTP()
    const expiryMinutes = await getOTPExpiry()
    record.otp = otp
    record.expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000)
    await record.save()

    const settings = await EmailSettings.findOne()
    await sendTemplateEmail('email_verification', email, {
      otp,
      firstName: record.pendingSignup?.firstName || 'User',
      email,
      expiryMinutes: String(expiryMinutes),
      platformName: settings?.fromName || 'Vxness',
      supportEmail: settings?.fromEmail || 'support@vxness.in',
      year: new Date().getFullYear().toString(),
    })

    res.json({ message: 'A new code is on its way' })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/auth/register — one-shot signup, no OTP step.
router.post('/auth/register', async (req, res) => {
  try {
    const body = req.body || {}
    const email = String(body.email || '').trim().toLowerCase()
    if (!email || !body.password) return fail(res, 400, 'Email and password are required')
    if (await User.findOne({ email })) return fail(res, 400, 'An account with this email already exists')

    const user = await createSignupUser({ ...body, email })
    res.json(await issueSession(res, user))
  } catch (e) {
    fail(res, 500, e.message)
  }
})

/* ─────────────────  instrument price & bars  ───────────────── */

// GET /api/v1/instruments/:symbol/price — one live quote.
// Registered before the catalogue routes below would ever see it; Express
// matches in order and none of those take a :symbol, so there is no shadowing.
router.get('/instruments/:symbol/price', jwtAuth, (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').toUpperCase()
    const q = infowayService.getPrice(symbol)
    if (!q || !q.bid) return fail(res, 404, `No price for ${symbol}`)

    const meta = instrumentCatalogue().find(i => i.symbol === symbol)
    res.json({
      symbol,
      name: meta?.name || symbol,
      bid: q.bid,
      ask: q.ask,
      spread: q.ask != null && q.bid != null ? Number((q.ask - q.bid).toFixed(8)) : null,
      change: q.change ?? null,
      change_pct: q.changePercent ?? q.change_pct ?? null,
      digits: meta?.digits ?? 5,
      time: q.time || Date.now(),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/instruments/:symbol/bars?resolution=&from=&to=&countback=&limit=
//
// The app's bundled chart is a separate build from the web's, but it must draw
// the same candles, so both go through the one fetchBars() in routes/charts.js.
// from/to/countback are passed straight through — they are what lets the chart
// page backwards as the user scrolls; without them every scroll would re-fetch
// the most recent bars and the chart would look like it had no history.
router.get('/instruments/:symbol/bars', jwtAuth, async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').toUpperCase()
    const bars = await fetchBars(symbol, String(req.query.resolution || '60'), {
      from: req.query.from,
      to: req.query.to,
      countback: req.query.countback,
      limit: parseInt(req.query.limit, 10) || undefined,
    })
    res.json({ s: 'ok', symbol, bars, noData: bars.length === 0 })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

/* ─────────────────────  account admin  ───────────────────── */

// DELETE /api/v1/accounts/:id — archive, then delete once empty.
//
// The web requires the account to be archived first and refuses otherwise. The
// app has no separate archive step, so this does both: it archives an active
// account and then removes it, which is the behaviour the Close button implies.
// A balance still on the account blocks the delete — losing funds to a stray tap
// is not something to be tidy about.
router.delete('/accounts/:id', jwtAuth, async (req, res) => {
  try {
    const account = await ownedAccount(req.user._id, req.params.id)

    const openTrades = await Trade.countDocuments({ tradingAccountId: account._id, status: 'OPEN' })
    if (openTrades > 0) return fail(res, 400, 'Close your open positions before closing this account')

    if (Number(account.balance || 0) > 0.01) {
      return fail(res, 400, 'Withdraw the remaining balance before closing this account')
    }

    await Trade.deleteMany({ tradingAccountId: account._id })
    await TradingAccount.findByIdAndDelete(account._id)

    res.json({ message: 'Account closed' })
  } catch (e) {
    fail(res, e.status || 500, e.message)
  }
})

/* ─────────────────────  funding  ───────────────────── */

// POST /api/v1/wallet/deposit/bank-details — where to send a manual deposit.
// POST, not GET: that is what the app sends, and changing the client would put
// old installs out of step with the server.
router.post('/wallet/deposit/bank-details', jwtAuth, async (_req, res) => {
  try {
    const pm = await PaymentMethod.findOne({ isActive: true }).sort({ createdAt: -1 })
    if (!pm) return res.json({})

    res.json({
      type: pm.type || 'bank',
      bank_name: pm.bankName || '',
      account_number: pm.accountNumber || '',
      account_holder_name: pm.accountHolderName || '',
      ifsc_code: pm.ifscCode || '',
      upi_id: pm.upiId || '',
      qr_code_url: pm.qrCodeImage || '',
      wallet_address: pm.walletAddress || '',
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

function txPage(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20))
  return { page, perPage, skip: (page - 1) * perPage }
}

function txJson(t) {
  return {
    id: String(t._id),
    type: t.type,
    method: t.paymentMethod || '',
    amount: t.amount,
    currency: 'USD',
    status: t.status,
    description: t.description || '',
    reference: t.transactionRef || '',
    created_at: t.createdAt,
  }
}

// GET /api/v1/wallet/deposits
router.get('/wallet/deposits', jwtAuth, async (req, res) => {
  try {
    const { page, perPage, skip } = txPage(req)
    const query = { userId: req.user._id, type: { $in: ['Deposit', 'Challenge_Purchase'] } }
    const [items, total] = await Promise.all([
      Transaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(perPage),
      Transaction.countDocuments(query),
    ])
    res.json({ items: items.map(txJson), page, per_page: perPage, total })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/wallet/withdrawals
router.get('/wallet/withdrawals', jwtAuth, async (req, res) => {
  try {
    const { page, perPage, skip } = txPage(req)
    const query = { userId: req.user._id, type: { $in: ['Withdrawal', 'Payout'] } }
    const [items, total] = await Promise.all([
      Transaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(perPage),
      Transaction.countDocuments(query),
    ])
    res.json({ items: items.map(txJson), page, per_page: perPage, total })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/wallet/transfer-internal — {from_account_id, to_account_id, amount}
// Account → account. Both accounts are resolved through ownedAccount(), so a
// transfer can never reach an account the caller does not hold.
router.post('/wallet/transfer-internal', jwtAuth, async (req, res) => {
  try {
    const fromId = req.body?.from_account_id
    const toId = req.body?.to_account_id
    const amount = Number(req.body?.amount)

    if (!fromId || !toId) return fail(res, 400, 'Both accounts are required')
    if (String(fromId) === String(toId)) return fail(res, 400, 'Choose two different accounts')
    if (!(amount > 0)) return fail(res, 400, 'Enter an amount greater than zero')

    const from = await ownedAccount(req.user._id, fromId)
    const to = await ownedAccount(req.user._id, toId)

    if (from.status !== 'Active') return fail(res, 400, 'The source account is not active')
    if (to.status !== 'Active') return fail(res, 400, 'The destination account is not active')
    if (Number(from.balance || 0) < amount) return fail(res, 400, 'Insufficient balance in the source account')

    from.balance -= amount
    to.balance += amount
    await from.save()
    await to.save()

    const ref = `ACCTRF${Date.now()}`
    await Transaction.create([
      {
        userId: req.user._id,
        type: 'Account_Transfer_Out',
        amount,
        paymentMethod: 'Internal',
        tradingAccountId: from._id,
        tradingAccountName: from.accountId,
        toTradingAccountId: to._id,
        toTradingAccountName: to.accountId,
        status: 'Completed',
        transactionRef: ref,
      },
      {
        userId: req.user._id,
        type: 'Account_Transfer_In',
        amount,
        paymentMethod: 'Internal',
        tradingAccountId: to._id,
        tradingAccountName: to.accountId,
        fromTradingAccountId: from._id,
        fromTradingAccountName: from.accountId,
        status: 'Completed',
        transactionRef: ref,
      },
    ])

    res.json({
      message: `$${amount} moved from ${from.accountId} to ${to.accountId}`,
      from_balance: from.balance,
      to_balance: to.balance,
    })
  } catch (e) {
    fail(res, e.status || 500, e.message)
  }
})

/* ─────────────────  uploads: KYC & manual funding  ───────────────── */

// Files land in the same folders the web writes to (backend/uploads/...), so
// one admin screen reviews submissions from either client and the stored path
// means the same thing on both.
const v1UploadDir = (sub) => {
  const dir = pathV1.join(dirnameV1, '..', 'uploads', sub)
  if (!fsV1.existsSync(dir)) fsV1.mkdirSync(dir, { recursive: true })
  return dir
}

const v1Upload = (sub, prefix) => multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, v1UploadDir(sub)),
    filename: (_req, file, cb) => {
      const ext = pathV1.extname(file.originalname) || '.jpg'
      cb(null, `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
    cb(ok.includes(file.mimetype) ? null : new Error('Only images or PDF are accepted'), ok.includes(file.mimetype))
  },
})

const kycUploadV1 = v1Upload('kyc', 'kyc')
const proofUploadV1 = v1Upload('screenshots', 'proof')

// multer rejects (bad type, too large) surface as thrown errors, which would
// otherwise become a bare 500. Wrap so the app shows the real reason.
const runUpload = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (err) return fail(res, 400, err.message || 'Upload failed')
  next()
})

// POST /api/v1/profile/kyc/submit — multipart: document_type, document_number,
// file (front), optional file_2 (back) and file_3 (selfie).
router.post(
  '/profile/kyc/submit',
  jwtAuth,
  runUpload(kycUploadV1.fields([{ name: 'file', maxCount: 1 }, { name: 'file_2', maxCount: 1 }, { name: 'file_3', maxCount: 1 }])),
  async (req, res) => {
    try {
      const documentType = String(req.body?.document_type || '').trim()
      const documentNumber = String(req.body?.document_number || '').trim()
      const files = req.files || {}

      if (!documentType) return fail(res, 400, 'Select a document type')
      if (!documentNumber) return fail(res, 400, 'Enter the document number')
      if (!files.file?.[0]) return fail(res, 400, 'Attach the front of the document')

      const existing = await KYC.findOne({ userId: req.user._id, status: { $in: ['pending', 'approved'] } })
      if (existing) {
        return fail(res, 400, existing.status === 'approved'
          ? 'Your KYC is already approved'
          : 'You already have a submission awaiting review')
      }

      const url = (f) => (f ? `/uploads/kyc/${f.filename}` : null)
      const kyc = await KYC.create({
        userId: req.user._id,
        documentType,
        documentNumber,
        frontImage: url(files.file[0]),
        backImage: url(files.file_2?.[0]),
        selfieImage: url(files.file_3?.[0]),
        status: 'pending',
        submittedAt: new Date(),
      })

      res.json({ id: String(kyc._id), status: kyc.status, message: 'Documents submitted for review' })
    } catch (e) {
      // An invalid document_type trips the schema enum — say which field.
      if (e?.name === 'ValidationError') return fail(res, 400, 'That document type is not accepted')
      fail(res, 500, e.message)
    }
  }
)

// POST /api/v1/wallet/deposit/manual — multipart: amount, transaction_id, file.
// Saved as Pending; the admin's existing approval flow credits the wallet and
// applies any first-deposit bonus, exactly as it does for a web deposit.
router.post('/wallet/deposit/manual', jwtAuth, runUpload(proofUploadV1.single('file')), async (req, res) => {
  try {
    const amount = Number(req.body?.amount)
    const transactionRef = String(req.body?.transaction_id || '').trim()
    if (!(amount > 0)) return fail(res, 400, 'Enter an amount greater than zero')
    if (!req.file) return fail(res, 400, 'Attach the payment screenshot')

    let wallet = await Wallet.findOne({ userId: req.user._id })
    if (!wallet) wallet = await new Wallet({ userId: req.user._id, balance: 0 }).save()

    const tx = await Transaction.create({
      userId: req.user._id,
      walletId: wallet._id,
      type: 'Deposit',
      amount,
      paymentMethod: 'Manual',
      transactionRef,
      screenshot: `/uploads/screenshots/${req.file.filename}`,
      status: 'Pending',
      description: 'Manual deposit from mobile app',
    })

    res.json({ id: String(tx._id), status: tx.status, amount, message: 'Deposit submitted for approval' })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/wallet/withdraw/manual — multipart: amount, upi_id, payout_notes,
// optional file (QR). The balance is held now and settled on approval, so the
// same funds cannot be requested twice while a request is pending.
router.post('/wallet/withdraw/manual', jwtAuth, runUpload(proofUploadV1.single('file')), async (req, res) => {
  try {
    const amount = Number(req.body?.amount)
    if (!(amount > 0)) return fail(res, 400, 'Enter an amount greater than zero')

    const wallet = await Wallet.findOne({ userId: req.user._id })
    if (!wallet) return fail(res, 404, 'Wallet not found')
    if (Number(wallet.balance || 0) < amount) return fail(res, 400, 'Insufficient wallet balance')

    const upiId = String(req.body?.upi_id || '').trim()
    const notes = String(req.body?.payout_notes || '').trim()

    wallet.balance -= amount
    await wallet.save()

    const tx = await Transaction.create({
      userId: req.user._id,
      walletId: wallet._id,
      type: 'Withdrawal',
      amount,
      paymentMethod: upiId ? 'UPI' : 'Manual',
      bankAccountDetails: upiId ? { type: 'UPI', upiId } : undefined,
      screenshot: req.file ? `/uploads/screenshots/${req.file.filename}` : undefined,
      status: 'Pending',
      description: notes || 'Withdrawal request from mobile app',
    })

    res.json({
      id: String(tx._id),
      status: tx.status,
      amount,
      wallet_balance: wallet.balance,
      message: 'Withdrawal requested',
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/wallet/deposit/local-banking — opens a pending deposit the user
// then confirms with a payment proof (two-step local bank transfer).
router.post('/wallet/deposit/local-banking', jwtAuth, runUpload(proofUploadV1.none()), async (req, res) => {
  try {
    const amount = Number(req.body?.amount)
    if (!(amount > 0)) return fail(res, 400, 'Enter an amount greater than zero')

    let wallet = await Wallet.findOne({ userId: req.user._id })
    if (!wallet) wallet = await new Wallet({ userId: req.user._id, balance: 0 }).save()

    const pm = await PaymentMethod.findOne({ isActive: true }).sort({ createdAt: -1 })

    const tx = await Transaction.create({
      userId: req.user._id,
      walletId: wallet._id,
      type: 'Deposit',
      amount,
      paymentMethod: 'Local Banking',
      status: 'Pending',
      description: 'Local banking deposit — awaiting payment proof',
    })

    res.json({
      id: String(tx._id),
      deposit_id: String(tx._id),
      amount,
      status: tx.status,
      bank_details: pm ? {
        bank_name: pm.bankName || '',
        account_number: pm.accountNumber || '',
        account_holder_name: pm.accountHolderName || '',
        ifsc_code: pm.ifscCode || '',
        upi_id: pm.upiId || '',
        qr_code_url: pm.qrCodeImage || '',
      } : null,
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/wallet/deposit/local-banking/:id/confirm-payment — attach proof.
router.post(
  '/wallet/deposit/local-banking/:id/confirm-payment',
  jwtAuth,
  runUpload(proofUploadV1.single('file')),
  async (req, res) => {
    try {
      const tx = await Transaction.findOne({ _id: req.params.id, userId: req.user._id })
      if (!tx) return fail(res, 404, 'Deposit not found')
      if (tx.status !== 'Pending') return fail(res, 400, 'This deposit has already been processed')
      if (!req.file) return fail(res, 400, 'Attach the payment proof')

      const amount = Number(req.body?.amount)
      if (amount > 0) tx.amount = amount
      tx.transactionRef = String(req.body?.transaction_id || '').trim() || tx.transactionRef
      tx.screenshot = `/uploads/screenshots/${req.file.filename}`
      tx.description = 'Local banking deposit — proof submitted'
      await tx.save()

      res.json({ id: String(tx._id), status: tx.status, message: 'Payment proof submitted for approval' })
    } catch (e) {
      fail(res, 500, e.message)
    }
  }
)

/* ─────────────────────  IB programme  ───────────────────── */

// The app calls these /business/* paths; the web calls /api/ib/*. Both read the
// same records — only the response shape differs, and the IB here is always the
// caller from the token rather than a :userId in the path.

// GET /api/v1/business/status
router.get('/business/status', jwtAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    const status = String(user?.ibStatus || '').toUpperCase()

    res.json({
      is_ib: !!user?.isIB && status === 'ACTIVE',
      application_status: status ? status.toLowerCase() : null,
      referral_code: user?.referralCode || '',
      rejection_reason: user?.ibRejectionReason || '',
      id: String(user?._id || ''),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/business/apply
router.post('/business/apply', jwtAuth, async (req, res) => {
  try {
    const user = await ibEngineNew.applyForIB(req.user._id, req.body?.requested_level_id || null)
    res.json({
      message: 'Application submitted — an admin will review it shortly',
      application_status: String(user.ibStatus || '').toLowerCase(),
      referral_code: user.referralCode || '',
    })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

// GET /api/v1/business/ib/dashboard
router.get('/business/ib/dashboard', jwtAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('ibLevelId')
    if (!user?.isIB) return fail(res, 403, 'You are not an approved IB yet')

    const wallet = await IBWallet.getOrCreateWallet(req.user._id)
    const totalReferrals = await User.countDocuments({ parentIBId: req.user._id })

    // CREDITED only — a REVERSED commission was clawed back and must not still
    // be counted as something this IB earned.
    const [earned] = await IBCommissionNew.aggregate([
      { $match: { ibUserId: user._id, status: 'CREDITED' } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
    ])
    const totalEarned = Number(earned?.total || 0)

    res.json({
      total_earned: totalEarned,
      total_commission: totalEarned,
      pending_payout: Number(wallet?.balance || 0),
      level: Number(user.ibLevelOrder || 1),
      level_name: user.ibLevelId?.name || user.ibLevel || '',
      total_referrals: totalReferrals,
      is_active: String(user.ibStatus || '').toUpperCase() === 'ACTIVE',
      referral_code: user.referralCode || '',
      referral_link: user.referralCode ? `https://vxness.in/user/signup?ref=${user.referralCode}` : '',
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/business/ib/referrals
router.get('/business/ib/referrals', jwtAuth, async (req, res) => {
  try {
    const referrals = await User.find({ parentIBId: req.user._id })
      .select('firstName email createdAt')
      .sort({ createdAt: -1 })

    // Deposits and account counts in two aggregates rather than two queries per
    // row — an IB with a few hundred referrals would otherwise hammer Mongo.
    const ids = referrals.map(r => r._id)
    const [deposits, accounts] = await Promise.all([
      Transaction.aggregate([
        { $match: { userId: { $in: ids }, type: 'Deposit', status: 'Approved' } },
        { $group: { _id: '$userId', total: { $sum: '$amount' } } },
      ]),
      TradingAccount.aggregate([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: '$userId', n: { $sum: 1 } } },
      ]),
    ])
    const depMap = Object.fromEntries(deposits.map(d => [String(d._id), d.total]))
    const accMap = Object.fromEntries(accounts.map(a => [String(a._id), a.n]))

    res.json({
      items: referrals.map(r => ({
        id: String(r._id),
        referred_user: {
          name: r.firstName || '',
          email: r.email,
          joined_at: r.createdAt,
        },
        total_deposit: depMap[String(r._id)] || 0,
        accounts_count: accMap[String(r._id)] || 0,
        created_at: r.createdAt,
      })),
      total: referrals.length,
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/business/ib/commissions
router.get('/business/ib/commissions', jwtAuth, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const commissions = await IBCommissionNew.find({ ibUserId: req.user._id })
      .populate('traderUserId', 'firstName email')
      .sort({ createdAt: -1 })
      .limit(limit)

    res.json({
      items: commissions.map(c => ({
        id: String(c._id),
        source_user: {
          name: c.traderUserId?.firstName || '',
          email: c.traderUserId?.email || '',
        },
        commission_type: c.commissionType || '',
        amount: c.commissionAmount,
        mlm_level: c.level ?? 1,
        status: String(c.status || 'credited').toLowerCase(),
        symbol: c.symbol || '',
        created_at: c.createdAt,
      })),
      total: commissions.length,
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/business/ib/tree
router.get('/business/ib/tree', jwtAuth, async (req, res) => {
  try {
    const maxDepth = Math.min(10, Math.max(1, parseInt(req.query.max_depth, 10) || 5))
    const chain = await ibEngineNew.getIBChain(req.user._id, maxDepth)
    const tree = Array.isArray(chain) ? chain : (chain ? [chain] : [])

    const countNodes = (nodes) => nodes.reduce(
      (n, node) => n + 1 + countNodes(node?.children || node?.downline || []), 0)

    res.json({ tree, total_nodes: countNodes(tree) })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

/* ─────────────────────  copy trading  ───────────────────── */

// The Copy tab reads a flatter shape than /social/masters returns, and looks for
// several spellings of each field. masterJson stays the single mapping; these
// aliases sit on top so one record satisfies both readers.
const providerJson = (m) => {
  const base = masterJson(m)
  return {
    ...base,
    provider_id: base.id,
    name: base.manager_name,
    provider_name: base.manager_name,
    win_rate: base.win_rate_pct,
    followers_count: base.total_investors,
    follower_count: base.total_investors,
  }
}

// GET /api/v1/social/leaderboard — the masters list, ranked.
router.get('/social/leaderboard', jwtAuth, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30))
    const sort = String(req.query.sort || 'overall')

    const sortBy = sort === 'win_rate' ? { 'stats.winRate': -1 }
      : sort === 'followers' ? { 'stats.activeFollowers': -1 }
      : { 'stats.totalProfitGenerated': -1 }

    const masters = await MasterTrader.find({ status: 'ACTIVE' })
      .populate('userId', 'firstName lastName')
      .sort({ ...sortBy, createdAt: -1 })
      .limit(limit)

    res.json({ items: masters.map(providerJson), page: 1, per_page: limit })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/social/providers/:id
router.get('/social/providers/:id', jwtAuth, async (req, res) => {
  try {
    const m = await MasterTrader.findById(req.params.id).populate('userId', 'firstName lastName')
    if (!m) return fail(res, 404, 'Trader not found')
    res.json(providerJson(m))
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/social/providers/:id/activity — recent closed trades.
router.get('/social/providers/:id/activity', jwtAuth, async (req, res) => {
  try {
    const m = await MasterTrader.findById(req.params.id)
    if (!m) return fail(res, 404, 'Trader not found')

    const trades = await Trade.find({ tradingAccountId: m.tradingAccountId, status: 'CLOSED' })
      .sort({ closedAt: -1, updatedAt: -1 })
      .limit(30)

    res.json({
      items: trades.map(t => ({
        id: String(t._id),
        symbol: t.symbol,
        side: t.side,
        lots: t.quantity,
        open_price: t.openPrice,
        close_price: t.closePrice,
        pnl: money(t.realizedPnl ?? t.pnl ?? 0),
        closed_at: t.closedAt || t.updatedAt,
      })),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/social/copy — start copying a master with an allocation.
router.post('/social/copy', jwtAuth, async (req, res) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) }
    const masterId = src.provider_id || src.master_id
    const amount = Number(src.amount)
    const accountId = src.account_id

    if (!masterId) return fail(res, 400, 'Choose a trader to copy')
    if (!(amount > 0)) return fail(res, 400, 'Enter an amount greater than zero')
    if (!accountId) return fail(res, 400, 'Choose which account to copy with')

    const account = await ownedAccount(req.user._id, accountId)
    const master = await MasterTrader.findById(masterId)
    if (!master || master.status !== 'ACTIVE') return fail(res, 404, 'Trader not available')

    // Copying yourself would have the engine mirroring a trade back onto the
    // account that opened it.
    if (String(master.userId) === String(req.user._id)) {
      return fail(res, 400, 'You cannot copy your own strategy')
    }
    if (Number(account.balance || 0) < amount) return fail(res, 400, 'Insufficient balance on that account')

    const existing = await CopyFollower.findOne({
      followerId: req.user._id,
      masterId: master._id,
      status: { $in: ['ACTIVE', 'PAUSED'] },
    })
    if (existing) return fail(res, 400, 'You are already copying this trader')

    const follower = await CopyFollower.create({
      followerId: req.user._id,
      masterId: master._id,
      followerAccountId: account._id,
      copyMode: 'BALANCE_BASED',
      copyValue: amount,
      status: 'ACTIVE',
      startedAt: new Date(),
    })

    await MasterTrader.findByIdAndUpdate(master._id, {
      $inc: { 'stats.totalFollowers': 1, 'stats.activeFollowers': 1 },
    })

    res.json({ id: String(follower._id), message: 'You are now copying this trader' })
  } catch (e) {
    fail(res, e.status || 400, e.message)
  }
})

// DELETE /api/v1/social/copy/:id — stop copying.
router.delete('/social/copy/:id', jwtAuth, async (req, res) => {
  try {
    const follower = await CopyFollower.findOne({ _id: req.params.id, followerId: req.user._id })
    if (!follower) return fail(res, 404, 'Subscription not found')
    if (follower.status === 'STOPPED') return fail(res, 400, 'This subscription is already stopped')

    follower.status = 'STOPPED'
    follower.stoppedAt = new Date()
    await follower.save()

    // Only the active count comes down — totalFollowers is a lifetime tally.
    await MasterTrader.findByIdAndUpdate(follower.masterId, { $inc: { 'stats.activeFollowers': -1 } })

    res.json({ message: 'Stopped copying' })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/social/become-provider — apply to become a master trader.
router.post('/social/become-provider', jwtAuth, async (req, res) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) }
    const accountId = src.account_id
    if (!accountId) return fail(res, 400, 'Choose the account to publish')

    const account = await ownedAccount(req.user._id, accountId)

    const existing = await MasterTrader.findOne({ userId: req.user._id })
    if (existing) {
      return fail(res, 400, existing.status === 'ACTIVE'
        ? 'You are already a master trader'
        : 'Your application is already under review')
    }

    const master = await MasterTrader.create({
      userId: req.user._id,
      tradingAccountId: account._id,
      displayName: String(src.display_name || src.name || '').trim() || undefined,
      description: String(src.description || '').trim(),
      requestedCommissionPercentage: Number(src.commission_pct ?? src.commission_rate ?? 0),
      status: 'PENDING',
    })

    res.json({
      id: String(master._id),
      status: master.status,
      message: 'Application submitted — an admin will review it shortly',
    })
  } catch (e) {
    fail(res, e.status || 400, e.message)
  }
})

/* ─────────────────────  prop challenges  ───────────────────── */

// The prop-firm challenge surface, mirroring what the web dashboard shows on
// its Account page. Challenge mode is an admin switch (PropSettings), so every
// route here reports `enabled` and the buy refuses while it is off — the app
// must hide the whole section rather than offer a purchase that cannot happen.
//
// Unlike /api/prop/* (the web routes), the user is taken from the verified
// token and never from the payload, so one account holder cannot buy a
// challenge against another's wallet.

// GET /api/v1/prop/status — is challenge mode on?
router.get('/prop/status', jwtAuth, async (_req, res) => {
  try {
    const settings = await PropSettings.getSettings()
    res.json({
      enabled: !!settings.challengeModeEnabled,
      display_name: settings.displayName || 'Challenge',
      description: settings.description || '',
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/prop/challenges — the challenges available to buy.
router.get('/prop/challenges', jwtAuth, async (_req, res) => {
  try {
    const settings = await PropSettings.getSettings()
    if (!settings.challengeModeEnabled) return res.json({ enabled: false, items: [] })

    const challenges = await Challenge.find({ isActive: true }).sort({ sortOrder: 1, fundSize: 1 })
    res.json({
      enabled: true,
      items: challenges.map(c => ({
        challenge_id: String(c._id),
        name: c.name,
        fund_size: c.fundSize,
        challenge_fee: c.challengeFee,
        currency: c.currency || 'USD',
        steps_count: c.stepsCount,
        expiry_days: c.rules?.challengeExpiryDays ?? null,
        profit_split_percent: c.fundedSettings?.profitSplitPercent ?? null,
        profit_target_phase1_percent: c.rules?.profitTargetPhase1Percent ?? null,
        profit_target_phase2_percent: c.rules?.profitTargetPhase2Percent ?? null,
        max_daily_drawdown_percent: c.rules?.maxDailyDrawdownPercent ?? null,
        max_overall_drawdown_percent: c.rules?.maxOverallDrawdownPercent ?? null,
        drawdown_type: c.rules?.drawdownType || 'STATIC',
        min_trading_days: c.rules?.tradingDaysRequired ?? null,
        description: c.description || '',
      })),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/prop/accounts — the caller's challenge accounts, with live
// equity/drawdown from the same helper the web route uses.
router.get('/prop/accounts', jwtAuth, async (req, res) => {
  try {
    const query = { userId: req.user._id }
    if (req.query?.status) query.status = String(req.query.status)

    const accounts = await ChallengeAccount.find(query)
      .populate('challengeId')
      .sort({ createdAt: -1 })

    const enriched = await enrichChallengeAccounts(accounts)
    res.json({
      accounts: enriched.map(a => ({
        account_id: String(a._id),
        account_number: a.accountId,
        challenge_name: a.challengeId?.name || '',
        fund_size: a.challengeId?.fundSize ?? a.initialBalance,
        status: a.status,
        phase: a.currentPhase,
        currency: a.challengeId?.currency || 'USD',
        total_phases: a.totalPhases,
        balance: a.currentBalance,
        equity: a.currentEquity,
        initial_balance: a.initialBalance,
        floating_pnl: a.floatingPnl,
        profit_percent: a.currentProfitPercent,
        daily_drawdown_percent: a.currentDailyDrawdownPercent,
        overall_drawdown_percent: a.currentOverallDrawdownPercent,
        // Phase 2 targets a smaller gain than phase 1 — send the one that
        // applies to the phase this account is actually in.
        profit_target_percent: (a.currentPhase === 2
          ? a.challengeId?.rules?.profitTargetPhase2Percent
          : a.challengeId?.rules?.profitTargetPhase1Percent) ?? null,
        max_daily_drawdown_percent: a.challengeId?.rules?.maxDailyDrawdownPercent ?? null,
        max_overall_drawdown_percent: a.challengeId?.rules?.maxOverallDrawdownPercent ?? null,
        fail_reason: a.failReason || '',
        expires_at: a.expiresAt,
        created_at: a.createdAt,
      })),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/prop/buy — {challenge_id}. Pays the fee from the main wallet.
router.post('/prop/buy', jwtAuth, async (req, res) => {
  try {
    const challengeId = req.body?.challenge_id || req.body?.challengeId
    if (!challengeId) return fail(res, 400, 'challenge_id is required')

    const settings = await PropSettings.getSettings()
    if (!settings.challengeModeEnabled) return fail(res, 400, 'Challenge mode is currently disabled')

    const challenge = await Challenge.findById(challengeId)
    if (!challenge || !challenge.isActive) return fail(res, 404, 'Challenge not found or inactive')

    const fee = challenge.challengeFee || 0

    let wallet = await Wallet.findOne({ userId: req.user._id })
    if (!wallet) wallet = await new Wallet({ userId: req.user._id, balance: 0 }).save()

    if (wallet.balance < fee) {
      return fail(res, 400, `Insufficient balance. Required: $${fee}, available: $${wallet.balance}`)
    }

    wallet.balance -= fee
    await wallet.save()

    const transaction = await new Transaction({
      userId: req.user._id,
      walletId: wallet._id,
      type: 'Challenge_Purchase',
      amount: fee,
      status: 'Approved',
      paymentMethod: 'Wallet',
      description: `Challenge Purchase: ${challenge.name} ($${challenge.fundSize.toLocaleString()} Fund)`,
      processedAt: new Date(),
    }).save()

    const account = await propTradingEngine.createChallengeAccount(req.user._id, challengeId, transaction._id)
    transaction.challengeAccountId = account._id
    await transaction.save()

    res.json({
      account: {
        account_id: String(account._id),
        account_number: account.accountId,
        status: account.status,
        initial_balance: account.initialBalance,
        expires_at: account.expiresAt,
      },
      wallet_balance: wallet.balance,
    })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

// GET /api/v1/instruments/ - the catalogue, without prices. Same source as the
// website's /api/prices/instruments, so the two can never disagree.
const catalogueJson = () => instrumentCatalogue().map(i => ({
  symbol: i.symbol,
  name: i.name,
  category: i.category,
  digits: i.digits,
  contract_size: i.contractSize,
  min_volume: i.minVolume,
  max_volume: i.maxVolume,
  volume_step: i.volumeStep,
  popular: i.popular,
}))

router.get('/instruments', jwtAuth, (_req, res) => res.json({ items: catalogueJson() }))
router.get('/instruments/', jwtAuth, (_req, res) => res.json({ items: catalogueJson() }))

router.get('/instruments/prices/all', jwtAuth, (_req, res) => {
  const items = []
  for (const i of instrumentCatalogue()) {
    const q = infowayService.getPrice(i.symbol)
    if (!q) continue
    items.push({
      symbol: i.symbol,
      name: i.name,
      category: i.category,
      digits: i.digits,
      bid: q.bid,
      ask: q.ask,
      // Spread in points, the unit the platform quotes it in everywhere else.
      spread: money((q.ask - q.bid) * Math.pow(10, (i.digits || 5) - 1)),
      time: q.timestamp || q.time || null,
      market_open: isMarketOpen(i.symbol),
    })
  }
  res.json({ items })
})

/* ────────────────  account summary, groups, opening  ──────────────── */

// GET /api/v1/accounts/:id/summary - the numbers under the balance on Home.
router.get('/accounts/:id/summary', jwtAuth, async (req, res) => {
  try {
    const account = await ownedAccount(req.user._id, req.params.id)
    if (!account) return fail(res, 404, 'Trading account not found for this user')

    const open = await Trade.find({ tradingAccountId: account._id, status: 'OPEN' })
    let used = 0
    let floating = 0
    for (const t of open) {
      used += t.marginUsed || 0
      const q = liveQuote(t.symbol)
      if (q) floating += tradeEngine.calculateFloatingPnl(t, q.bid, q.ask)
    }
    const balance = account.balance || 0
    const credit = account.credit || 0
    const equity = balance + credit + floating

    res.json({
      account_id: String(account._id),
      account_number: account.accountId,
      currency: 'USD',
      leverage: account.leverage,
      balance: money(balance),
      credit: money(credit),
      equity: money(equity),
      total_equity: money(equity),
      floating_pnl: money(floating),
      open_pnl: money(floating),
      margin_used: money(used),
      free_margin: money(equity - used),
      margin_level: used > 0 ? money((equity / used) * 100) : 0,
      open_positions_count: open.length,
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/accounts/available-groups - the account types on offer.
router.get('/accounts/available-groups', jwtAuth, async (_req, res) => {
  try {
    const types = await AccountType.find({ isActive: true }).sort({ minDeposit: 1 })
    res.json({
      items: types.map(t => ({
        id: String(t._id),
        name: t.name,
        description: t.description || '',
        min_deposit: money(t.minDeposit),
        leverage: t.leverage,
        is_demo: !!t.isDemo,
        demo_balance: money(t.demoBalance),
        commission: money(t.commission),
        min_spread: t.minSpread ?? null,
      })),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/v1/accounts/open  {account_group_id|group_id|account_type_id, leverage?}
router.post('/accounts/open', jwtAuth, async (req, res) => {
  try {
    // account_group_id is what the app actually sends, and an installed APK
    // cannot be changed retroactively — so the server accepts every spelling
    // rather than the one that happened to be written here first.
    const typeId = req.body?.account_group_id
      || req.body?.group_id
      || req.body?.account_type_id
      || req.body?.accountTypeId
    const type = typeId ? await AccountType.findById(String(typeId)) : null
    if (!type || !type.isActive) return fail(res, 400, 'Choose an available account type')

    const user = await User.findById(req.user._id).select('kycApproved')
    // A demo account is a sandbox and needs no identity check; a live one moves
    // real money and does.
    if (!type.isDemo && !user?.kycApproved) {
      return fail(res, 403, 'Complete KYC verification before opening a live account')
    }

    const leverage = String(req.body?.leverage || type.leverage || '1:100')
    const accountId = String(Date.now()).slice(-8)
    const account = await TradingAccount.create({
      userId: req.user._id,
      accountTypeId: type._id,
      accountId,
      leverage,
      balance: type.isDemo ? (type.demoBalance || 0) : 0,
      credit: 0,
      status: 'Active',
      isDemo: !!type.isDemo,
    })
    res.json({
      message: 'Account created',
      account_id: String(account._id),
      account_number: account.accountId,
      is_demo: !!account.isDemo,
      balance: money(account.balance),
      leverage: account.leverage,
    })
  } catch (e) {
    fail(res, 400, e.message)
  }
})

/* ─────────────────────────  portfolio  ───────────────────────── */

// The accounts a portfolio call covers: one when named, otherwise all of them.
async function portfolioAccounts(userId, accountId) {
  if (accountId) {
    const a = await ownedAccount(userId, accountId)
    return a ? [a] : []
  }
  return TradingAccount.find({ userId, status: 'Active' })
}

// GET /api/v1/portfolio/summary?account_id=
router.get('/portfolio/summary', jwtAuth, async (req, res) => {
  try {
    const accounts = await portfolioAccounts(req.user._id, req.query.account_id)
    if (!accounts.length) return fail(res, 404, 'Trading account not found for this user')
    const ids = accounts.map(a => a._id)

    const open = await Trade.find({ tradingAccountId: { $in: ids }, status: 'OPEN' })
    let floating = 0
    let used = 0
    const bySymbol = new Map()
    for (const t of open) {
      used += t.marginUsed || 0
      const q = liveQuote(t.symbol)
      const pnl = q ? tradeEngine.calculateFloatingPnl(t, q.bid, q.ask) : 0
      floating += pnl
      const cur = bySymbol.get(t.symbol) || { symbol: t.symbol, lots: 0, positions: 0, unrealized_pnl: 0 }
      cur.lots += t.quantity || 0
      cur.positions += 1
      cur.unrealized_pnl += pnl
      bySymbol.set(t.symbol, cur)
    }

    const balance = accounts.reduce((t, a) => t + (a.balance || 0), 0)
    const credit = accounts.reduce((t, a) => t + (a.credit || 0), 0)
    const equity = balance + credit + floating

    // Today's realised P/L, from midnight UTC - the same boundary the rest of
    // the platform counts a trading day by.
    const since = new Date(); since.setUTCHours(0, 0, 0, 0)
    const closedToday = await Trade.find({
      tradingAccountId: { $in: ids }, status: 'CLOSED', closedAt: { $gte: since },
    }).select('realizedPnl commission swap')
    const realizedToday = closedToday.reduce((t, c) => t + (c.realizedPnl || 0), 0)

    res.json({
      balance: money(balance),
      total_balance: money(balance),
      credit: money(credit),
      equity: money(equity),
      total_equity: money(equity),
      total_unrealized_pnl: money(floating),
      today_pnl: money(realizedToday),
      margin_used: money(used),
      free_margin: money(equity - used),
      open_positions_count: open.length,
      holdings: [...bySymbol.values()].map(h => ({
        ...h,
        lots: money(h.lots),
        unrealized_pnl: money(h.unrealized_pnl),
      })).sort((a, b) => b.unrealized_pnl - a.unrealized_pnl),
      pnl_breakdown: {
        unrealized: money(floating),
        realized_today: money(realizedToday),
        commission_today: money(closedToday.reduce((t, c) => t + (c.commission || 0), 0)),
        swap_today: money(closedToday.reduce((t, c) => t + (c.swap || 0), 0)),
      },
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/v1/portfolio/performance?period=&account_id=
//
// Built from CLOSED trades only, and the equity curve is a running total of
// realised P/L rather than true equity: nothing snapshots equity over time, and
// a curve drawn from floating P/L would rewrite its own history on every tick.
router.get('/portfolio/performance', jwtAuth, async (req, res) => {
  try {
    const accounts = await portfolioAccounts(req.user._id, req.query.account_id)
    if (!accounts.length) return fail(res, 404, 'Trading account not found for this user')
    const ids = accounts.map(a => a._id)

    const days = { '7d': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 }[String(req.query.period || '1m')] || 30
    const since = new Date(Date.now() - days * 86400000)

    const closed = await Trade.find({
      tradingAccountId: { $in: ids }, status: 'CLOSED', closedAt: { $gte: since },
    }).sort({ closedAt: 1 }).select('symbol realizedPnl closedAt quantity side')

    let running = 0
    const curve = []
    const perSymbol = new Map()
    const perMonth = new Map()
    let wins = 0
    let grossWin = 0
    let grossLoss = 0
    let best = 0
    let worst = 0

    for (const t of closed) {
      const pnl = t.realizedPnl || 0
      running += pnl
      curve.push({ t: t.closedAt?.toISOString?.() || '', value: money(running) })

      if (pnl > 0) { wins += 1; grossWin += pnl } else { grossLoss += Math.abs(pnl) }
      if (pnl > best) best = pnl
      if (pnl < worst) worst = pnl

      const sy = perSymbol.get(t.symbol) || { symbol: t.symbol, trades: 0, pnl: 0, lots: 0 }
      sy.trades += 1; sy.pnl += pnl; sy.lots += t.quantity || 0
      perSymbol.set(t.symbol, sy)

      const key = (t.closedAt || new Date()).toISOString().slice(0, 7)
      const mo = perMonth.get(key) || { month: key, trades: 0, pnl: 0 }
      mo.trades += 1; mo.pnl += pnl
      perMonth.set(key, mo)
    }

    res.json({
      period: String(req.query.period || '1m'),
      equity_curve: curve,
      stats: {
        total_trades: closed.length,
        wins,
        losses: closed.length - wins,
        win_rate_pct: closed.length ? money((wins / closed.length) * 100) : 0,
        total_pnl: money(running),
        best_trade: money(best),
        worst_trade: money(worst),
        profit_factor: grossLoss > 0 ? money(grossWin / grossLoss) : (grossWin > 0 ? 0 : 0),
        gross_profit: money(grossWin),
        gross_loss: money(grossLoss),
      },
      symbol_breakdown: [...perSymbol.values()]
        .map(x => ({ ...x, pnl: money(x.pnl), lots: money(x.lots) }))
        .sort((a, b) => b.pnl - a.pnl),
      monthly_breakdown: [...perMonth.values()]
        .map(x => ({ ...x, pnl: money(x.pnl) }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

export default router
