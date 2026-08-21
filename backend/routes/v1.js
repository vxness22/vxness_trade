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
import AlgoKey from '../models/AlgoKey.js'
import TerminalRefreshToken, { REFRESH_TTL_DAYS } from '../models/TerminalRefreshToken.js'
import infowayService, { SUPPORTED_SYMBOLS } from '../services/infowayService.js'
import tradeEngine from '../services/tradeEngine.js'
import { contractSize as symbolContractSize } from '../utils/symbolMeta.js'
import { resolveTradeSegment } from '../utils/tradeSegment.js'
import { jwtAuth, ownedAccount, signAccessToken, fail } from '../utils/terminalAuth.js'
import { validatePendingBrackets } from '../utils/bracketGuard.js'

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
    const accounts = await TradingAccount.find({
      userId: req.user._id,
      status: { $ne: 'Archived' },
    }).populate('accountTypeId', 'name isDemo leverage').sort({ createdAt: -1 })

    res.json({
      accounts: accounts.map(a => ({
        account_id: String(a._id),
        account_number: a.accountId,
        is_demo: !!(a.isDemo || a.accountTypeId?.isDemo),
        currency: 'USD',
        balance: a.balance,
        credit: a.credit,
        leverage: a.leverage,
        type: a.accountTypeId?.name || '',
        status: a.status,
      })),
    })
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

const ORDER_TYPE = {
  'buy:limit': 'BUY_LIMIT',
  'buy:stop': 'BUY_STOP',
  'sell:limit': 'SELL_LIMIT',
  'sell:stop': 'SELL_STOP',
}

function orderJson(t) {
  return {
    id: String(t._id),
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
    const orderType = ORDER_TYPE[`${side}:${type}`]
    if (!orderType) return fail(res, 400, 'side must be buy/sell and order_type limit/stop')

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

export default router
