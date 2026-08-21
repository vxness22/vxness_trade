// /api/algo/* — the market-data + execution surface the desktop terminal talks
// to. Authenticated with an API key/secret pair (see utils/terminalAuth.js), so
// it keeps working across the ~45-minute lifetime of a JWT access token.
//
// Field naming is snake_case throughout because that is what the terminal's
// ApiClient parses (core/ApiClient.cpp). Errors are {"detail": "..."} for the
// same reason — ApiError.h reads that key and nothing else.

import express from 'express'
import Trade from '../models/Trade.js'
import TradingAccount from '../models/TradingAccount.js'
import infowayService, { SUPPORTED_SYMBOLS } from '../services/infowayService.js'
import tradeEngine from '../services/tradeEngine.js'
import copyTradingEngine from '../services/copyTradingEngine.js'
import MasterTrader from '../models/MasterTrader.js'
import { contractSize as symbolContractSize } from '../utils/symbolMeta.js'
import { resolveTradeSegment } from '../utils/tradeSegment.js'
import { isMarketOpen } from '../utils/marketHours.js'
import { algoAuth, fail } from '../utils/terminalAuth.js'
import { loadSpreadTable, applySpread, digitsFor } from '../utils/terminalQuotes.js'
import { validateBrackets } from '../utils/bracketGuard.js'

const router = express.Router()

router.use(algoAuth)

// Timeframes infowayService.getCandles understands.
const VALID_TIMEFRAMES = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1mn'])

const DISPLAY_NAMES = {
  XAUUSD: 'Gold', XAGUSD: 'Silver', XPTUSD: 'Platinum', XPDUSD: 'Palladium',
  USOIL: 'US Oil', UKOIL: 'UK Oil', NGAS: 'Natural Gas', COPPER: 'Copper',
  BTCUSD: 'Bitcoin', ETHUSD: 'Ethereum', SOLUSD: 'Solana', XRPUSD: 'XRP',
  LTCUSD: 'Litecoin', DOGEUSD: 'Dogecoin', ADAUSD: 'Cardano', BNBUSD: 'BNB',
}

function displayName(symbol) {
  if (DISPLAY_NAMES[symbol]) return DISPLAY_NAMES[symbol]
  if (/^[A-Z]{6}$/.test(symbol)) return `${symbol.slice(0, 3)}/${symbol.slice(3)}`
  return symbol
}

// GET /api/algo/symbols — instrument specs for the watchlist and chart scale.
router.get('/symbols', (req, res) => {
  const symbols = SUPPORTED_SYMBOLS.map((s) => ({
    symbol: s,
    display_name: displayName(s),
    category: resolveTradeSegment(s),
    digits: digitsFor(s),
    min_lot: 0.01,
    max_lot: 100,
    lot_step: 0.01,
    contract_size: symbolContractSize(s),
  }))
  res.json({ symbols })
})

// GET /api/algo/account — balance / equity / margin for the key's account.
router.get('/account', async (req, res) => {
  try {
    const account = req.account
    const openTrades = await Trade.find({ tradingAccountId: account._id, status: 'OPEN' })

    const prices = {}
    for (const t of openTrades) {
      const p = infowayService.getPrice(t.symbol)
      if (p) prices[t.symbol] = { bid: p.bid, ask: p.ask }
    }

    const summary = await tradeEngine.getAccountSummary(account._id, openTrades, prices)

    res.json({
      account: account.accountId,
      currency: 'USD',
      leverage: parseInt(String(account.leverage).replace('1:', ''), 10) || 100,
      balance: summary.balance,
      credit: summary.credit,
      equity: summary.equity,
      margin_used: summary.usedMargin,
      free_margin: summary.freeMargin,
      margin_level: summary.marginLevel,
      is_demo: !!account.isDemo,
      open_positions: openTrades.length,
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/algo/prices[?symbols=A,B] — snapshot, admin spread applied.
router.get('/prices', async (req, res) => {
  try {
    const requested = String(req.query.symbols || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    const list = requested.length ? requested : SUPPORTED_SYMBOLS

    const table = await loadSpreadTable(req.user._id, req.account.accountTypeId?._id, list)

    const prices = []
    for (const symbol of list) {
      const raw = infowayService.getPrice(symbol)
      if (!raw || !(raw.bid > 0)) continue
      const q = applySpread(symbol, raw.bid, raw.ask, table.get(symbol))
      prices.push({
        symbol,
        bid: q.bid,
        ask: q.ask,
        spread: q.ask - q.bid,
        timestamp: new Date(raw.time || Date.now()).toISOString(),
      })
    }
    res.json({ prices })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// GET /api/algo/bars?symbol=&timeframe=&limit= — historical OHLC.
// Bars are MID (Infoway klines); the terminal's datafeed shifts them to BID by
// half the live spread, exactly like the web chart does.
router.get('/bars', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').toUpperCase()
    const timeframe = String(req.query.timeframe || '1m')
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 300))

    if (!SUPPORTED_SYMBOLS.includes(symbol)) return fail(res, 404, `Unknown symbol ${symbol}`)
    if (!VALID_TIMEFRAMES.has(timeframe)) return fail(res, 400, `Unsupported timeframe ${timeframe}`)

    const candles = await infowayService.getCandles(symbol, timeframe, new Date(), limit)
    res.json({
      symbol,
      timeframe,
      bars: candles.map(c => ({
        time: new Date(c.time).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.tickVolume ?? 0,
      })),
    })
  } catch (e) {
    fail(res, 500, e.message)
  }
})

// POST /api/algo/trade — {action: BUY|SELL|CLOSE, symbol, volume, sl?, tp?}
//
// Prices are taken from the server's own feed, never from the request. The web
// path still accepts client-supplied bid/ask; this one deliberately does not.
router.post('/trade', async (req, res) => {
  try {
    const action = String(req.body?.action || '').toUpperCase()
    const symbol = String(req.body?.symbol || '').toUpperCase()

    if (!['BUY', 'SELL', 'CLOSE'].includes(action)) {
      return fail(res, 400, 'action must be BUY, SELL or CLOSE')
    }
    if (!symbol) return fail(res, 400, 'symbol is required')
    if (!SUPPORTED_SYMBOLS.includes(symbol)) return fail(res, 404, `Unknown symbol ${symbol}`)

    const account = req.account
    if (account.status !== 'Active') return fail(res, 403, `Account is ${account.status}`)

    const price = infowayService.getPrice(symbol)
    if (!price || !(price.bid > 0) || !(price.ask > 0)) {
      return fail(res, 503, `No live price for ${symbol}. Please try again.`)
    }

    // ---- CLOSE: flatten every open position on this symbol ----
    if (action === 'CLOSE') {
      const open = await Trade.find({
        tradingAccountId: account._id, symbol, status: 'OPEN'
      })
      if (!open.length) {
        return res.json({
          status: 'no_positions', symbol, action, closed_count: 0, total_profit: 0,
          message: `No open positions on ${symbol}`,
        })
      }

      let closed = 0
      let total = 0
      const errors = []
      for (const t of open) {
        try {
          const r = await tradeEngine.closeTrade(t._id, price.bid, price.ask, 'USER')
          closed += 1
          total += r.realizedPnl
        } catch (err) {
          errors.push(err.message)
        }
      }

      if (!closed) return fail(res, 400, errors[0] || 'Could not close positions')

      return res.json({
        status: 'closed',
        symbol,
        action,
        closed_count: closed,
        total_profit: Math.round(total * 100) / 100,
        message: errors.length
          ? `Closed ${closed} of ${open.length}; ${errors[0]}`
          : `Closed ${closed} position${closed === 1 ? '' : 's'}`,
      })
    }

    // ---- BUY / SELL: market order ----
    const volume = parseFloat(req.body?.volume)
    if (!Number.isFinite(volume) || volume <= 0) return fail(res, 400, 'volume must be greater than 0')

    if (!req.user.kycApproved) {
      return fail(res, 403, 'Complete KYC verification and wait for admin approval before trading.')
    }
    if (!isMarketOpen(symbol)) {
      return fail(res, 400, `Market is closed for ${symbol}.`)
    }

    const sl = Number(req.body?.sl) > 0 ? Number(req.body.sl) : null
    const tp = Number(req.body?.tp) > 0 ? Number(req.body.tp) : null

    // A bracket the market has already passed is fired by the SL/TP sweep on its
    // next look, so the position closes itself minutes after opening. This route
    // accepted any level above zero, which is how a GBPUSD BUY came to carry a
    // stop of 4372 — see utils/bracketGuard.js. Judged against the server's own
    // quote, the same one the fill is priced at.
    const bracketErr = validateBrackets(action, sl, tp, price)
    if (bracketErr) return fail(res, 400, bracketErr)

    const trade = await tradeEngine.openTrade(
      req.user._id,
      account._id,
      symbol,
      resolveTradeSegment(symbol),
      action,
      'MARKET',
      volume,
      price.bid,
      price.ask,
      sl,
      tp
    )

    // Mirror the web path: a master trader's fills are copied to followers.
    try {
      const master = await MasterTrader.findOne({ tradingAccountId: account._id, status: 'ACTIVE' })
      if (master) await copyTradingEngine.copyTradeToFollowers(trade, master._id)
    } catch (copyErr) {
      console.error('[algo] copy-trade fan-out failed:', copyErr.message)
    }

    res.json({
      status: 'filled',
      symbol,
      action,
      lots: trade.quantity,
      price: trade.openPrice,
      position_id: String(trade._id),
      order_id: trade.tradeId,
      message: `${action} ${trade.quantity} ${symbol} at ${trade.openPrice}`,
    })
  } catch (e) {
    // openTrade throws plain Errors for business rejections (margin, market
    // closed, limits) — those are 400s the trader can act on, not 500s.
    fail(res, 400, e.message)
  }
})

export default router
