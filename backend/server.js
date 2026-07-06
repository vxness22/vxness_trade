import express from 'express'

import mongoose from 'mongoose'

import cors from 'cors'

import compression from 'compression'

import dotenv from 'dotenv'

import { createServer } from 'http'

import { Server } from 'socket.io'

import cron from 'node-cron'

import authRoutes from './routes/auth.js'

import adminRoutes from './routes/admin.js'

import accountTypesRoutes from './routes/accountTypes.js'

import tradingAccountsRoutes from './routes/tradingAccounts.js'

import walletRoutes from './routes/wallet.js'

import paymentMethodsRoutes from './routes/paymentMethods.js'

import tradeRoutes from './routes/trade.js'

import walletTransferRoutes from './routes/walletTransfer.js'

import adminTradeRoutes from './routes/adminTrade.js'

import copyTradingRoutes from './routes/copyTrading.js'

import ibRoutes from './routes/ibNew.js'

import propTradingRoutes from './routes/propTrading.js'

import chargesRoutes from './routes/charges.js'

import pricesRoutes from './routes/prices.js'

import chartsRoutes from './routes/charts.js'

import earningsRoutes from './routes/earnings.js'

import supportRoutes from './routes/support.js'

import kycRoutes from './routes/kyc.js'

import themeRoutes from './routes/theme.js'

import adminManagementRoutes from './routes/adminManagement.js'

import uploadRoutes from './routes/upload.js'

import emailTemplatesRoutes from './routes/emailTemplates.js'

import bonusRoutes from './routes/bonus.js'

import technicalAnalysisRoutes from './routes/technicalAnalysis.js'

import marginAlertsRoutes from './routes/marginAlerts.js'

import path from 'path'

import { fileURLToPath } from 'url'

import copyTradingEngine from './services/copyTradingEngine.js'

import tradeEngine from './services/tradeEngine.js'

import propTradingEngine from './services/propTradingEngine.js'

import infowayService from './services/infowayService.js'
import { SUPPORTED_SYMBOLS, CRYPTO_SYMBOLS } from './services/infowayService.js'
import ChallengeAccount from './models/ChallengeAccount.js'



const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)



dotenv.config()



const app = express()

const httpServer = createServer(app)



// Socket.IO for real-time updates

const io = new Server(httpServer, {

  cors: {

    origin: '*',

    methods: ['GET', 'POST']

  }

})



// Store connected clients

const connectedClients = new Map()

const priceSubscribers = new Set()



// Price cache for real-time streaming

const priceCache = new Map()



// Initialize Infoway WebSocket streaming connection

let infowayConnected = false



async function initInfowayConnection() {

  try {

    console.log('[Infoway] Initializing WebSocket connection...')

    infowayConnected = await infowayService.connect()



    if (infowayConnected) {

      console.log('[Infoway] Connected! Live tick-by-tick streaming active.')



      // Subscribe to tick-by-tick price updates from Infoway

      infowayService.subscribe((symbol, price) => {

        priceCache.set(symbol, price)



        // Broadcast to frontend Socket.IO subscribers immediately (tick-by-tick)

        if (priceSubscribers.size > 0) {

          io.to('prices').emit('priceStream', {

            prices: Object.fromEntries(priceCache),

            updated: { [symbol]: price },

            timestamp: Date.now()

          })

        }

      })

    } else {

      console.log('[Infoway] Connection failed. Prices will use fallback values.')

    }

  } catch (error) {

    console.error('[Infoway] Connection error:', error.message)

  }

}



// Background task: sync prices and broadcast to subscribers

async function streamPrices() {

  // Sync all Infoway prices (forex + crypto via WebSocket) into priceCache

  const allPrices = infowayService.getAllPrices()

  Object.entries(allPrices).forEach(([symbol, price]) => {

    if (price && price.bid) {

      priceCache.set(symbol, price)

    }

  })



  // Broadcast full price snapshot to subscribers

  if (priceSubscribers.size > 0) {

    io.to('prices').emit('priceStream', {

      prices: Object.fromEntries(priceCache),

      timestamp: Date.now()

    })

  }

}



console.log('Price streaming initialized - Infoway WebSocket')



// Initialize Infoway connection on startup

initInfowayConnection()



// Fetch initial prices after WebSocket warm-up

setTimeout(async () => {

  console.log('[Prices] Syncing initial prices...')

  await streamPrices()

  console.log('[Prices] Initial prices loaded:', priceCache.size, 'symbols')

}, 3000)



// Periodic snapshot broadcast (per-tick callbacks already push live; this is a safety net)

setInterval(streamPrices, 2000)



// Background stop-out check every 5 seconds

// This ensures trades are closed even if user closes browser

setInterval(async () => {

  try {

    if (priceCache.size === 0) return // No prices yet

    

    // Convert priceCache to object format expected by tradeEngine

    const currentPrices = {}

    priceCache.forEach((data, symbol) => {

      currentPrices[symbol] = { bid: data.bid, ask: data.ask }

    })

    

    const result = await tradeEngine.checkAllAccountsStopOut(currentPrices)

    if (result.stopOuts && result.stopOuts.length > 0) {

      console.log(`[STOP-OUT] ${result.stopOuts.length} accounts stopped out`)

    }

  } catch (error) {

    // Silent fail - don't spam logs

  }

}, 5000)



// Background SL/TP check every 2 seconds

// This ensures SL/TP triggers even if user closes the app

setInterval(async () => {

  try {

    if (priceCache.size === 0) return // No prices yet

    

    // Convert priceCache to object format expected by tradeEngine

    const currentPrices = {}

    priceCache.forEach((data, symbol) => {

      currentPrices[symbol] = { bid: data.bid, ask: data.ask }

    })

    

    // Check SL/TP for regular trades

    const closedRegularTrades = await tradeEngine.checkSlTpForAllTrades(currentPrices)

    

    // Check SL/TP for challenge trades

    const closedChallengeTrades = await propTradingEngine.checkSlTpForAllTrades(currentPrices)

    

    const allClosed = [...closedRegularTrades, ...closedChallengeTrades]

    if (allClosed.length > 0) {

      console.log(`[SL/TP AUTO] ${allClosed.length} trades closed by SL/TP`)

      allClosed.forEach(ct => {

        console.log(`[SL/TP AUTO] ${ct.trade?.symbol || 'Unknown'} closed by ${ct.trigger || ct.reason} - PnL: ${ct.pnl?.toFixed(2) || 0}`)

      })

    }

  } catch (error) {

    // Silent fail - don't spam logs

  }

}, 1000)





io.on('connection', (socket) => {

  console.log('Client connected:', socket.id)



  // Subscribe to real-time price stream

  socket.on('subscribePrices', () => {

    socket.join('prices')

    priceSubscribers.add(socket.id)

    // Send current prices immediately

    socket.emit('priceStream', {

      prices: Object.fromEntries(priceCache),

      updated: {},

      timestamp: Date.now()

    })

    console.log(`Socket ${socket.id} subscribed to price stream`)

  })



  // Unsubscribe from price stream

  socket.on('unsubscribePrices', () => {

    socket.leave('prices')

    priceSubscribers.delete(socket.id)

  })



  // Subscribe to account updates

  socket.on('subscribe', (data) => {

    const { tradingAccountId } = data

    if (tradingAccountId) {

      socket.join(`account:${tradingAccountId}`)

      connectedClients.set(socket.id, tradingAccountId)

      console.log(`Socket ${socket.id} subscribed to account ${tradingAccountId}`)

    }

  })



  // Unsubscribe from account updates

  socket.on('unsubscribe', (data) => {

    const { tradingAccountId } = data

    if (tradingAccountId) {

      socket.leave(`account:${tradingAccountId}`)

      connectedClients.delete(socket.id)

    }

  })



  // Handle price updates from client (for PnL calculation)

  socket.on('priceUpdate', async (data) => {

    const { tradingAccountId, prices } = data

    if (tradingAccountId && prices) {

      // Broadcast updated account summary to all subscribers

      io.to(`account:${tradingAccountId}`).emit('accountUpdate', {

        tradingAccountId,

        prices,

        timestamp: Date.now()

      })

    }

  })



  socket.on('disconnect', () => {

    connectedClients.delete(socket.id)

    priceSubscribers.delete(socket.id)

    console.log('Client disconnected:', socket.id)

  })

})



// Make io accessible to routes

app.set('io', io)



// Middleware

app.use(compression()) // Enable gzip compression for faster API responses

app.use(cors())

app.use(express.json({ limit: '50mb' }))

app.use(express.urlencoded({ limit: '50mb', extended: true }))



// Connect to MongoDB

mongoose.connect(process.env.MONGODB_URI)

  .then(() => console.log('Connected to MongoDB'))

  .catch((err) => console.error('MongoDB connection error:', err))



// Routes

app.use('/api/auth', authRoutes)

app.use('/api/admin', adminRoutes)

app.use('/api/account-types', accountTypesRoutes)

app.use('/api/trading-accounts', tradingAccountsRoutes)

app.use('/api/wallet', walletRoutes)

app.use('/api/payment-methods', paymentMethodsRoutes)

app.use('/api/trade', tradeRoutes)

app.use('/api/wallet-transfer', walletTransferRoutes)

app.use('/api/admin/trade', adminTradeRoutes)

app.use('/api/copy', copyTradingRoutes)

app.use('/api/ib', ibRoutes)

app.use('/api/prop', propTradingRoutes)

app.use('/api/charges', chargesRoutes)

app.use('/api/prices', pricesRoutes)

app.use('/api/charts', chartsRoutes)

app.use('/api/earnings', earningsRoutes)

app.use('/api/support', supportRoutes)

app.use('/api/kyc', kycRoutes)

app.use('/api/theme', themeRoutes)

app.use('/api/admin-mgmt', adminManagementRoutes)

app.use('/api/upload', uploadRoutes)

app.use('/api/email-templates', emailTemplatesRoutes)

app.use('/api/bonus', bonusRoutes)

app.use('/api/technical-analysis', technicalAnalysisRoutes)

app.use('/api/margin-alerts', marginAlertsRoutes)



// Serve uploaded files statically

app.use('/uploads', express.static(path.join(__dirname, 'uploads')))



// Serve APK download

app.get('/downloads/vxness.apk', (req, res) => {

  // APK stored in backend/apk folder

  const apkPath = path.join(__dirname, 'apk', 'vxness.apk')

  res.download(apkPath, 'vxness.apk', (err) => {

    if (err) {

      console.error('APK download error:', err)

      res.status(404).json({ error: 'APK not found' })

    }

  })

})



// Health check

app.get('/', (req, res) => {

  res.json({ message: 'vxness API is running' })

})



const PORT = process.env.PORT || 5000

httpServer.listen(PORT, () => {

  console.log(`Server running on port ${PORT}`)

  

  // Schedule daily commission calculation for copy trading

  // Runs at 11:59 PM every day (end of trading day)

  cron.schedule('59 23 * * *', async () => {

    console.log('[CRON] Running daily copy trade commission calculation...')

    try {

      const results = await copyTradingEngine.calculateDailyCommission()

      console.log(`[CRON] Daily commission calculated: ${results.length} commission records processed`)

    } catch (error) {

      console.error('[CRON] Error calculating daily commission:', error)

    }

  }, {

    timezone: 'UTC'

  })

  console.log('[CRON] Daily commission calculation scheduled for 23:59 UTC')

  

  // Schedule daily swap application for all open trades

  // Runs at 10:00 PM UTC (5:00 PM EST - forex rollover time)

  cron.schedule('0 22 * * *', async () => {

    console.log('[CRON] Applying daily swap to all open trades...')

    try {

      await tradeEngine.applySwap()

      console.log('[CRON] Swap applied successfully')

    } catch (error) {

      console.error('[CRON] Error applying swap:', error)

    }

  }, {

    timezone: 'UTC'

  })

  console.log('[CRON] Daily swap application scheduled for 22:00 UTC')

  // Reset daily drawdown baseline for all live challenge/funded accounts at 00:00 UTC
  cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Resetting daily drawdown for challenge accounts...')
    try {
      const accounts = await ChallengeAccount.find({ status: { $in: ['ACTIVE', 'FUNDED'] } })
      for (const acc of accounts) {
        await acc.resetDailyDrawdown()
      }
      console.log(`[CRON] Daily drawdown reset for ${accounts.length} challenge accounts`)
    } catch (error) {
      console.error('[CRON] Error resetting daily drawdown:', error)
    }
  }, {
    timezone: 'UTC'
  })

  console.log('[CRON] Daily challenge drawdown reset scheduled for 00:00 UTC')

})

