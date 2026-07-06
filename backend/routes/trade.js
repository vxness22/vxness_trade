import express from 'express'
import Trade from '../models/Trade.js'
import TradingAccount from '../models/TradingAccount.js'
import ChallengeAccount from '../models/ChallengeAccount.js'
import User from '../models/User.js'
import Charges from '../models/Charges.js'
import tradeEngine from '../services/tradeEngine.js'
import propTradingEngine from '../services/propTradingEngine.js'
import copyTradingEngine from '../services/copyTradingEngine.js'
import ibEngine from '../services/ibEngineNew.js'
import MasterTrader from '../models/MasterTrader.js'
import infowayService from '../services/infowayService.js'
import { resolveTradeSegment } from '../utils/tradeSegment.js'
import { commissionDollarAmount } from '../utils/commissionMath.js'
import { isMarketOpen } from '../utils/marketHours.js'

// Get price from cache (populated by background streamPrices in server.js)
function getFreshPrice(symbol) {
  const price = infowayService.getPrice(symbol)
  return price || null
}

const router = express.Router()

async function assertKycApprovedForUserId(userId, res) {
  if (!userId) {
    res.status(400).json({
      success: false,
      message: 'Missing user context',
      code: 'KYC_NOT_APPROVED'
    })
    return false
  }
  const user = await User.findById(userId).select('kycApproved')
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found', code: 'KYC_NOT_APPROVED' })
    return false
  }
  if (!user.kycApproved) {
    res.status(403).json({
      success: false,
      message: 'Complete KYC verification and wait for admin approval before using the trade terminal.',
      code: 'KYC_NOT_APPROVED'
    })
    return false
  }
  return true
}

// POST /api/trade/open - Open a new trade
router.post('/open', async (req, res) => {
  try {
    const { 
      userId, 
      tradingAccountId, 
      symbol, 
      segment, 
      side, 
      orderType, 
      quantity, 
      bid, 
      ask, 
      leverage,
      sl, 
      tp 
    } = req.body

    // Validate required fields
    if (!userId || !tradingAccountId || !symbol || !side || !orderType || !quantity) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      })
    }

    if (!(await assertKycApprovedForUserId(userId, res))) return

    // Check if market data is available (bid/ask must be valid numbers > 0)
    if (!bid || !ask || parseFloat(bid) <= 0 || parseFloat(ask) <= 0 || isNaN(parseFloat(bid)) || isNaN(parseFloat(ask))) {
      return res.status(400).json({ 
        success: false, 
        message: 'Market is closed or no price data available. Please try again when market is open.',
        code: 'MARKET_CLOSED'
      })
    }

    // Check for stale prices (if bid equals ask exactly, likely no real data)
    if (parseFloat(bid) === parseFloat(ask) && parseFloat(bid) === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No live market data. Trading is not available at this time.',
        code: 'NO_DATA_FEED'
      })
    }

    // Validate side
    if (!['BUY', 'SELL'].includes(side)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid side. Must be BUY or SELL' 
      })
    }

    // Validate order type
    const validOrderTypes = ['MARKET', 'BUY_LIMIT', 'BUY_STOP', 'SELL_LIMIT', 'SELL_STOP']
    if (!validOrderTypes.includes(orderType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order type'
      })
    }

    // Weekend market-closed guard: block NEW orders on instruments whose market is
    // closed on weekends (forex/metals/commodities/indices). Crypto stays open 24/7.
    // This is server-side enforcement so the rule can't be bypassed by calling the API
    // directly. (Closing existing trades and SL/TP auto-close are unaffected.)
    if (!isMarketOpen(symbol)) {
      return res.status(400).json({
        success: false,
        message: 'Market is closed on weekends for this instrument. Trading will resume when the market reopens.',
        code: 'MARKET_CLOSED_WEEKEND'
      })
    }

    // Check if this is a challenge account first
    const challengeAccount = await ChallengeAccount.findById(tradingAccountId).populate('challengeId')
    
    if (challengeAccount) {
      // This is a challenge account - use prop trading engine
      const tradeParams = {
        symbol,
        segment: segment || 'Forex',
        side,
        orderType,
        quantity: parseFloat(quantity),
        bid: parseFloat(bid),
        ask: parseFloat(ask),
        sl: sl ? parseFloat(sl) : null,
        tp: tp ? parseFloat(tp) : null
      }

      // Validate trade against challenge rules
      const validation = await propTradingEngine.validateTradeOpen(tradingAccountId, tradeParams)
      if (!validation.valid) {
        // Track violation and check if account should be failed
        const violationResult = await propTradingEngine.handleTradeAttemptViolation(tradingAccountId, validation)
        
        return res.status(400).json({
          success: false,
          message: violationResult.error,
          code: violationResult.code,
          uiAction: violationResult.uiAction,
          accountFailed: violationResult.accountFailed || false,
          failReason: violationResult.failReason || null,
          warningCount: violationResult.warningCount || 0,
          remainingWarnings: violationResult.remainingWarnings || 3
        })
      }

      // Open trade for challenge account
      const trade = await propTradingEngine.openChallengeTrade(
        userId,
        tradingAccountId,
        tradeParams
      )

      return res.json({
        success: true,
        message: 'Challenge trade opened successfully',
        trade,
        isChallengeAccount: true
      })
    }

    // Regular trading account - use standard trade engine
    const trade = await tradeEngine.openTrade(
      userId,
      tradingAccountId,
      symbol,
      segment || 'Forex',
      side,
      orderType,
      parseFloat(quantity),
      parseFloat(bid),
      parseFloat(ask),
      sl ? parseFloat(sl) : null,
      tp ? parseFloat(tp) : null,
      leverage // Pass user-selected leverage
    )

    // Check if this is a master trader and copy to followers
    const master = await MasterTrader.findOne({ 
      tradingAccountId, 
      status: 'ACTIVE' 
    })
    
    let copyResults = []
    if (master) {
      try {
        copyResults = await copyTradingEngine.copyTradeToFollowers(trade, master._id)
        console.log(`Copied trade to ${copyResults.filter(r => r.status === 'SUCCESS').length} followers`)
      } catch (copyError) {
        console.error('Error copying trade to followers:', copyError)
      }
    }

    res.json({
      success: true,
      message: 'Trade opened successfully',
      trade,
      copyResults: copyResults.length > 0 ? copyResults : undefined
    })
  } catch (error) {
    console.error('Error opening trade:', error)
    res.status(400).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// POST /api/trade/close - Close a trade
router.post('/close', async (req, res) => {
  try {
    const { tradeId, bid, ask } = req.body

    if (!tradeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Trade ID is required' 
      })
    }

    // Check if market data is available
    if (!bid || !ask || parseFloat(bid) <= 0 || parseFloat(ask) <= 0 || isNaN(parseFloat(bid)) || isNaN(parseFloat(ask))) {
      return res.status(400).json({ 
        success: false, 
        message: 'Market is closed or no price data available. Cannot close trade.',
        code: 'MARKET_CLOSED'
      })
    }

    // Get trade first to check if it's a challenge or master trade
    const tradeToClose = await Trade.findById(tradeId)
    
    if (!tradeToClose) {
      return res.status(404).json({ 
        success: false, 
        message: 'Trade not found' 
      })
    }

    if (!(await assertKycApprovedForUserId(tradeToClose.userId, res))) return

    // Check 3-minute minimum trade duration
    const tradeOpenTime = new Date(tradeToClose.openedAt || tradeToClose.createdAt)
    const now = new Date()
    const timeDiffMs = now - tradeOpenTime
    const threeMinutesMs = 3 * 60 * 1000 // 180000 ms

    console.log(`[3-MIN CHECK] Trade ${tradeToClose.tradeId}: openedAt=${tradeToClose.openedAt}, createdAt=${tradeToClose.createdAt}, timeDiff=${timeDiffMs}ms, required=${threeMinutesMs}ms`)

    if (timeDiffMs < threeMinutesMs) {
      const remainingSeconds = Math.ceil((threeMinutesMs - timeDiffMs) / 1000)
      console.log(`[3-MIN CHECK] BLOCKED! Trade ${tradeToClose.tradeId} - wait ${remainingSeconds} more seconds`)
      return res.status(400).json({
        success: false,
        message: `Trade cannot be closed before 3 minutes. Please wait ${remainingSeconds} seconds.`,
        code: 'MIN_DURATION_NOT_MET',
        remainingSeconds
      })
    }

    // Check if this is a challenge account trade
    const challengeAccount = await ChallengeAccount.findById(tradeToClose.tradingAccountId)
    
    if (challengeAccount) {
      // Close trade for challenge account
      const closePrice = tradeToClose.side === 'BUY' ? parseFloat(bid) : parseFloat(ask)
      const rawPnl = tradeToClose.side === 'BUY'
        ? (closePrice - tradeToClose.openPrice) * tradeToClose.quantity * tradeToClose.contractSize
        : (tradeToClose.openPrice - closePrice) * tradeToClose.quantity * tradeToClose.contractSize
      
      // Get charges for commission on close
      const charges = await Charges.getChargesForTrade(
        tradeToClose.userId, 
        tradeToClose.symbol, 
        resolveTradeSegment(tradeToClose.symbol, tradeToClose.segment), 
        null
      )
      
      // Calculate commission on close (asset-class-scaled via commissionMath, same as open)
      let closeCommission = 0
      if (charges.commissionOnClose && charges.commissionValue > 0) {
        closeCommission = commissionDollarAmount(
          tradeToClose.symbol,
          tradeToClose.quantity,
          closePrice,
          charges.commissionType,
          charges.commissionValue,
          tradeToClose.contractSize
        )
      }
      
      // Calculate final PnL (subtract swap and close commission)
      const pnl = rawPnl - (tradeToClose.swap || 0) - closeCommission
      
      // Update trade
      tradeToClose.status = 'CLOSED'
      tradeToClose.closePrice = closePrice
      tradeToClose.closedAt = new Date()
      tradeToClose.realizedPnl = pnl
      tradeToClose.closeReason = 'USER'
      await tradeToClose.save()
      
      // Update challenge account
      await propTradingEngine.onTradeClosed(challengeAccount._id, tradeToClose, pnl)
      
      return res.json({
        success: true,
        message: 'Challenge trade closed successfully',
        trade: tradeToClose,
        realizedPnl: pnl,
        isChallengeAccount: true
      })
    }
    
    // Regular trading account - use standard trade engine
    const result = await tradeEngine.closeTrade(
      tradeId,
      parseFloat(bid),
      parseFloat(ask),
      'USER'
    )

    // Check if this was a master trade and close follower trades
    if (tradeToClose) {
      console.log(`[CopyTrade] Checking if trade ${tradeId} belongs to a master. TradingAccountId: ${tradeToClose.tradingAccountId}`)
      const master = await MasterTrader.findOne({ 
        tradingAccountId: tradeToClose.tradingAccountId, 
        status: 'ACTIVE' 
      })
      
      console.log(`[CopyTrade] Master found: ${master ? master._id : 'NO MASTER FOUND'}`)
      
      if (master) {
        try {
          const closePrice = tradeToClose.side === 'BUY' ? parseFloat(bid) : parseFloat(ask)
          console.log(`[CopyTrade] Calling closeFollowerTrades for master trade ${tradeId} at price ${closePrice}`)
          const copyResults = await copyTradingEngine.closeFollowerTrades(tradeId, closePrice)
          console.log(`[CopyTrade] Closed ${copyResults.length} follower trades for master trade ${tradeId}`)
        } catch (copyError) {
          console.error('[CopyTrade] Error closing follower trades:', copyError)
        }
      }
    }

    // Process IB commission for the closed trade
    try {
      const ibResult = await ibEngine.processTradeCommission(result.trade)
      if (ibResult.processed) {
        console.log(`IB commission processed for trade ${result.trade._id}: ${ibResult.commissions?.length || 0} IBs credited`)
      }
    } catch (ibError) {
      console.error('Error processing IB commission:', ibError)
    }

    res.json({
      success: true,
      message: 'Trade closed successfully',
      trade: result.trade,
      realizedPnl: result.realizedPnl
    })
  } catch (error) {
    console.error('Error closing trade:', error)
    res.status(400).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// PUT /api/trade/modify - Modify trade SL/TP
router.put('/modify', async (req, res) => {
  try {
    const { tradeId, sl, tp } = req.body
    console.log('Modify trade request:', { tradeId, sl, tp })

    if (!tradeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Trade ID is required' 
      })
    }

    // First check if trade exists
    const existingTrade = await Trade.findById(tradeId)
    if (existingTrade && !(await assertKycApprovedForUserId(existingTrade.userId, res))) return
    if (!existingTrade) {
      console.log('Trade not found:', tradeId)
      return res.status(404).json({ 
        success: false, 
        message: 'Trade not found' 
      })
    }
    console.log('Found trade:', existingTrade.tradeId, existingTrade.status)

    // Parse values and handle NaN
    const parsedSl = sl !== undefined && sl !== null && sl !== '' ? parseFloat(sl) : null
    const parsedTp = tp !== undefined && tp !== null && tp !== '' ? parseFloat(tp) : null
    
    const trade = await tradeEngine.modifyTrade(
      tradeId,
      parsedSl !== null && !isNaN(parsedSl) ? parsedSl : null,
      parsedTp !== null && !isNaN(parsedTp) ? parsedTp : null
    )

    // Mirror SL/TP modification to follower trades
    const master = await MasterTrader.findOne({ 
      tradingAccountId: trade.tradingAccountId, 
      status: 'ACTIVE' 
    })
    
    if (master) {
      try {
        await copyTradingEngine.mirrorSlTpModification(
          tradeId,
          parsedSl,
          parsedTp
        )
        console.log(`Mirrored SL/TP modification to follower trades for ${tradeId}`)
      } catch (copyError) {
        console.error('Error mirroring SL/TP:', copyError)
      }
    }

    res.json({
      success: true,
      message: 'Trade modified successfully',
      trade
    })
  } catch (error) {
    console.error('Error modifying trade:', error)
    res.status(400).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// GET /api/trade/open/:tradingAccountId - Get all open trades for an account
router.get('/open/:tradingAccountId', async (req, res) => {
  try {
    const { tradingAccountId } = req.params

    const trades = await Trade.find({ 
      tradingAccountId, 
      status: 'OPEN' 
    }).sort({ openedAt: -1 })

    res.json({
      success: true,
      trades
    })
  } catch (error) {
    console.error('Error fetching open trades:', error)
    res.status(500).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// GET /api/trade/netting/:tradingAccountId - Get netted positions summary for an account
// Netting aggregates all positions by instrument showing net exposure
router.get('/netting/:tradingAccountId', async (req, res) => {
  try {
    const { tradingAccountId } = req.params

    // Get all open trades for this account
    const openTrades = await Trade.find({ 
      tradingAccountId, 
      status: 'OPEN' 
    })

    // Get current prices from cache (populated by background streamPrices)
    const symbols = [...new Set(openTrades.map(t => t.symbol))]
    const currentPrices = {}
    for (const symbol of symbols) {
      const price = infowayService.getPrice(symbol)
      if (price) {
        currentPrices[symbol] = price
      }
    }

    // Aggregate positions by symbol (netting logic)
    const nettedPositions = {}
    
    openTrades.forEach(trade => {
      const symbol = trade.symbol
      
      if (!nettedPositions[symbol]) {
        nettedPositions[symbol] = {
          symbol,
          segment: trade.segment,
          contractSize: trade.contractSize || 100000,
          leverage: trade.leverage,
          // Long (BUY) positions
          longQuantity: 0,
          longAvgPrice: 0,
          longMargin: 0,
          longPnl: 0,
          longTradeCount: 0,
          // Short (SELL) positions
          shortQuantity: 0,
          shortAvgPrice: 0,
          shortMargin: 0,
          shortPnl: 0,
          shortTradeCount: 0,
          // Net position
          netQuantity: 0,
          netDirection: 'FLAT',
          netPnl: 0,
          totalMargin: 0,
          totalTradeCount: 0,
          trades: []
        }
      }

      const pos = nettedPositions[symbol]
      const priceData = currentPrices[symbol]
      
      // Calculate PnL for this trade
      let tradePnl = 0
      if (priceData) {
        const currentPrice = trade.side === 'BUY' ? priceData.bid : priceData.ask
        if (trade.side === 'BUY') {
          tradePnl = (currentPrice - trade.openPrice) * trade.quantity * trade.contractSize
        } else {
          tradePnl = (trade.openPrice - currentPrice) * trade.quantity * trade.contractSize
        }
        tradePnl = tradePnl - (trade.commission || 0) - (trade.swap || 0)
      }

      // Add to long or short totals
      if (trade.side === 'BUY') {
        // Weighted average price calculation
        const totalLongValue = (pos.longAvgPrice * pos.longQuantity) + (trade.openPrice * trade.quantity)
        pos.longQuantity += trade.quantity
        pos.longAvgPrice = pos.longQuantity > 0 ? totalLongValue / pos.longQuantity : 0
        pos.longMargin += trade.marginUsed || 0
        pos.longPnl += tradePnl
        pos.longTradeCount++
      } else {
        // Weighted average price calculation
        const totalShortValue = (pos.shortAvgPrice * pos.shortQuantity) + (trade.openPrice * trade.quantity)
        pos.shortQuantity += trade.quantity
        pos.shortAvgPrice = pos.shortQuantity > 0 ? totalShortValue / pos.shortQuantity : 0
        pos.shortMargin += trade.marginUsed || 0
        pos.shortPnl += tradePnl
        pos.shortTradeCount++
      }

      // Store individual trade reference
      pos.trades.push({
        tradeId: trade.tradeId,
        side: trade.side,
        quantity: trade.quantity,
        openPrice: trade.openPrice,
        pnl: Math.round(tradePnl * 100) / 100
      })
    })

    // Calculate net positions and totals
    let totalNetPnl = 0
    let totalMargin = 0
    let totalLongQuantity = 0
    let totalShortQuantity = 0
    let totalTradeCount = 0

    const nettedArray = Object.values(nettedPositions).map(pos => {
      // Net quantity = Long - Short
      pos.netQuantity = Math.round((pos.longQuantity - pos.shortQuantity) * 100) / 100
      pos.netDirection = pos.netQuantity > 0 ? 'LONG' : pos.netQuantity < 0 ? 'SHORT' : 'FLAT'
      pos.netPnl = Math.round((pos.longPnl + pos.shortPnl) * 100) / 100
      pos.totalMargin = Math.round((pos.longMargin + pos.shortMargin) * 100) / 100
      pos.totalTradeCount = pos.longTradeCount + pos.shortTradeCount
      
      // Round values
      pos.longQuantity = Math.round(pos.longQuantity * 100) / 100
      pos.shortQuantity = Math.round(pos.shortQuantity * 100) / 100
      pos.longAvgPrice = Math.round(pos.longAvgPrice * 100000) / 100000
      pos.shortAvgPrice = Math.round(pos.shortAvgPrice * 100000) / 100000
      pos.longPnl = Math.round(pos.longPnl * 100) / 100
      pos.shortPnl = Math.round(pos.shortPnl * 100) / 100

      // Add current price
      pos.currentBid = currentPrices[pos.symbol]?.bid || 0
      pos.currentAsk = currentPrices[pos.symbol]?.ask || 0

      // Accumulate totals
      totalNetPnl += pos.netPnl
      totalMargin += pos.totalMargin
      totalLongQuantity += pos.longQuantity
      totalShortQuantity += pos.shortQuantity
      totalTradeCount += pos.totalTradeCount

      return pos
    })

    // Sort by absolute net PnL (largest exposure first)
    nettedArray.sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl))

    res.json({
      success: true,
      netting: {
        positions: nettedArray,
        summary: {
          totalInstruments: nettedArray.length,
          totalTrades: totalTradeCount,
          totalLongQuantity: Math.round(totalLongQuantity * 100) / 100,
          totalShortQuantity: Math.round(totalShortQuantity * 100) / 100,
          totalNetPnl: Math.round(totalNetPnl * 100) / 100,
          totalMargin: Math.round(totalMargin * 100) / 100
        }
      }
    })
  } catch (error) {
    console.error('Error calculating netting:', error)
    res.status(500).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// GET /api/trade/pending/:tradingAccountId - Get all pending orders for an account
router.get('/pending/:tradingAccountId', async (req, res) => {
  try {
    const { tradingAccountId } = req.params

    const trades = await Trade.find({ 
      tradingAccountId, 
      status: 'PENDING' 
    }).sort({ createdAt: -1 })

    res.json({
      success: true,
      trades
    })
  } catch (error) {
    console.error('Error fetching pending orders:', error)
    res.status(500).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// GET /api/trade/history/:tradingAccountId - Get trade history for an account (UNLIMITED - no auto-delete)
router.get('/history/:tradingAccountId', async (req, res) => {
  try {
    const { tradingAccountId } = req.params
    const { limit = 0, offset = 0 } = req.query // 0 = unlimited (no limit)

    let query = Trade.find({ 
      tradingAccountId, 
      status: { $in: ['CLOSED', 'STOPPED_OUT'] }
    })
      .sort({ closedAt: -1 })
      .skip(parseInt(offset))
      .populate('tradingAccountId', 'accountNumber')
    
    // Only apply limit if > 0
    if (parseInt(limit) > 0) {
      query = query.limit(parseInt(limit))
    }

    const trades = await query

    const total = await Trade.countDocuments({ 
      tradingAccountId, 
      status: { $in: ['CLOSED', 'STOPPED_OUT'] }
    })

    res.json({
      success: true,
      trades,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('Error fetching trade history:', error)
    res.status(500).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// GET /api/trade/summary/:tradingAccountId - Get account summary with real-time values
router.get('/summary/:tradingAccountId', async (req, res) => {
  try {
    const { tradingAccountId } = req.params
    const { prices } = req.query // JSON string of current prices

    // Check for regular trading account first
    let account = await TradingAccount.findById(tradingAccountId)
    let isChallengeAccount = false
    
    // If not found, check for challenge account
    if (!account) {
      const challengeAcc = await ChallengeAccount.findById(tradingAccountId)
      if (challengeAcc) {
        account = {
          balance: challengeAcc.currentBalance,
          credit: 0,
          equity: challengeAcc.currentEquity
        }
        isChallengeAccount = true
      }
    }
    
    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: 'Trading account not found' 
      })
    }

    const openTrades = await Trade.find({ 
      tradingAccountId, 
      status: 'OPEN' 
    })

    let currentPrices = {}
    if (prices) {
      try {
        currentPrices = JSON.parse(prices)
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Calculate used margin from open trades
    const usedMargin = openTrades.reduce((sum, t) => sum + (t.marginUsed || 0), 0)
    
    // Calculate floating PnL from current prices
    let floatingPnl = 0
    for (const trade of openTrades) {
      const priceData = currentPrices[trade.symbol]
      if (priceData) {
        const currentPrice = trade.side === 'BUY' ? priceData.bid : priceData.ask
        const pnl = trade.side === 'BUY'
          ? (currentPrice - trade.openPrice) * trade.quantity * trade.contractSize
          : (trade.openPrice - currentPrice) * trade.quantity * trade.contractSize
        floatingPnl += pnl
      }
    }

    // Calculate equity and free margin
    const balance = account.balance || 0
    const credit = account.credit || 0
    const equity = balance + credit + floatingPnl
    const freeMargin = equity - usedMargin
    const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0

    res.json({
      success: true,
      summary: {
        balance: Math.round(balance * 100) / 100,
        credit: Math.round(credit * 100) / 100,
        equity: Math.round(equity * 100) / 100,
        usedMargin: Math.round(usedMargin * 100) / 100,
        freeMargin: Math.round(freeMargin * 100) / 100,
        floatingPnl: Math.round(floatingPnl * 100) / 100,
        marginLevel: Math.round(marginLevel * 100) / 100
      },
      openTradesCount: openTrades.length
    })
  } catch (error) {
    console.error('Error fetching account summary:', error)
    res.status(500).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// POST /api/trade/check-stopout - Check and execute stop out if needed
router.post('/check-stopout', async (req, res) => {
  try {
    const { tradingAccountId, prices } = req.body

    if (!tradingAccountId) {
      return res.status(400).json({ success: false, message: 'Trading account ID required' })
    }

    let currentPrices = {}
    if (prices) {
      try {
        currentPrices = typeof prices === 'string' ? JSON.parse(prices) : prices
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Check if this is a challenge account
    const challengeAccount = await ChallengeAccount.findById(tradingAccountId)
    if (challengeAccount) {
      // For challenge accounts, check drawdown breach instead of stop out
      // This is handled by propTradingEngine during trade close
      return res.json({ success: true, stopOutTriggered: false, isChallengeAccount: true })
    }

    const result = await tradeEngine.checkStopOut(tradingAccountId, currentPrices)
    
    if (result && result.stopOutTriggered) {
      return res.json({
        success: true,
        stopOutTriggered: true,
        reason: result.reason,
        closedTradesCount: result.closedTrades?.length || 0,
        message: `STOP OUT: All trades closed due to ${result.reason}`
      })
    }

    res.json({ success: true, stopOutTriggered: false })
  } catch (error) {
    console.error('Error checking stop out:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/trade/cancel - Cancel a pending order
router.post('/cancel', async (req, res) => {
  try {
    const { tradeId } = req.body

    if (!tradeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Trade ID is required' 
      })
    }

    const trade = await Trade.findById(tradeId)
    if (!trade) {
      return res.status(404).json({ 
        success: false, 
        message: 'Trade not found' 
      })
    }

    if (!(await assertKycApprovedForUserId(trade.userId, res))) return

    if (trade.status !== 'PENDING') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only pending orders can be cancelled' 
      })
    }

    trade.status = 'CANCELLED'
    trade.closedAt = new Date()
    trade.closedBy = 'USER'
    await trade.save()

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      trade
    })
  } catch (error) {
    console.error('Error cancelling order:', error)
    res.status(500).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// GET /api/trade/debug-open - Debug endpoint to see all open trades with SL/TP
router.get('/debug-open', async (req, res) => {
  try {
    const openTrades = await Trade.find({ status: 'OPEN' })
    res.json({
      success: true,
      count: openTrades.length,
      trades: openTrades.map(t => ({
        tradeId: t.tradeId,
        symbol: t.symbol,
        side: t.side,
        openPrice: t.openPrice,
        sl: t.sl,
        stopLoss: t.stopLoss,
        tp: t.tp,
        takeProfit: t.takeProfit,
        isChallengeAccount: t.isChallengeAccount,
        status: t.status
      }))
    })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/trade/check-sltp - Check and trigger SL/TP for all trades
router.post('/check-sltp', async (req, res) => {
  try {
    const { prices } = req.body
    if (!prices || typeof prices !== 'object') {
      return res.status(400).json({ 
        success: false, 
        message: 'Prices object is required' 
      })
    }

    // Find all open trades with SL/TP to get their symbols
    const tradesWithSlTp = await Trade.find({
      status: 'OPEN',
      $or: [
        { sl: { $ne: null } },
        { stopLoss: { $ne: null } },
        { tp: { $ne: null } },
        { takeProfit: { $ne: null } }
      ]
    }).select('symbol')
    
    // Get unique symbols that need fresh prices
    const symbolsNeedingFreshPrices = [...new Set(tradesWithSlTp.map(t => t.symbol))]
    
    // Fetch fresh prices for symbols with SL/TP trades
    const freshPrices = { ...prices }
    for (const symbol of symbolsNeedingFreshPrices) {
      const freshPrice = getFreshPrice(symbol)
      if (freshPrice) {
        freshPrices[symbol] = freshPrice
      }
    }

    // Check SL/TP for all open challenge trades
    const closedChallengeTrades = await propTradingEngine.checkSlTpForAllTrades(freshPrices)
    
    // Check SL/TP for all regular trades
    const closedRegularTrades = await tradeEngine.checkSlTpForAllTrades(freshPrices)

    const allClosedTrades = [...closedChallengeTrades, ...closedRegularTrades]

    res.json({
      success: true,
      closedCount: allClosedTrades.length,
      closedTrades: allClosedTrades.map(ct => ({
        tradeId: ct.trade.tradeId,
        symbol: ct.trade.symbol,
        reason: ct.trigger || ct.reason,
        pnl: ct.pnl
      }))
    })
  } catch (error) {
    console.error('Error checking SL/TP:', error)
    res.status(500).json({ 
      success: false, 
      message: error.message 
    })
  }
})

// POST /api/trade/check-pending - Check and execute pending orders when price is reached
router.post('/check-pending', async (req, res) => {
  try {
    const { prices } = req.body

    if (!prices || typeof prices !== 'object') {
      return res.status(400).json({ 
        success: false, 
        message: 'Prices object is required' 
      })
    }

    // Check pending orders for execution
    const executedTrades = await tradeEngine.checkPendingOrders(prices)

    res.json({
      success: true,
      executedCount: executedTrades.length,
      executedTrades: executedTrades.map(et => ({
        tradeId: et.trade.tradeId,
        symbol: et.trade.symbol,
        side: et.trade.side,
        orderType: et.trade.orderType,
        executionPrice: et.executionPrice,
        executedAt: et.executedAt
      }))
    })
  } catch (error) {
    console.error('Error checking pending orders:', error)
    res.status(500).json({ 
      success: false, 
      message: error.message 
    })
  }
})

export default router
