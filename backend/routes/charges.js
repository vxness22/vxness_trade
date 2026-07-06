import express from 'express'
import Charges from '../models/Charges.js'
import AccountType from '../models/AccountType.js'
import { resolveTradeSegment } from '../utils/tradeSegment.js'

const router = express.Router()

const normInstrumentKey = (s) => (s == null || s === '' ? '' : String(s).toUpperCase())

// Pushes 'chargesUpdated' so every connected trading UI refetches spreads/commissions immediately.
const emitChargesUpdated = (req, payload = {}) => {
  try { req.app.get('io')?.emit('chargesUpdated', { at: Date.now(), ...payload }) } catch {}
}

// Live trading config — never let Cloudflare/proxies cache a stale response.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  next()
})

// Default symbol universe (merged with ?symbols= from client instruments list)
const DEFAULT_SPREAD_SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD', 'EURGBP', 'EURJPY', 'GBPJPY',
  'XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD',
  'BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BNBUSD', 'SOLUSD', 'ADAUSD', 'DOGEUSD', 'DOTUSD', 'MATICUSD', 'AVAXUSD', 'LINKUSD',
  'US30', 'US500', 'NAS100',
]

// GET /api/charges/spreads — same merged spread as tradeEngine (getChargesForTrade only).
// Admin-set Charges are the sole source; AccountType.minSpread is no longer a fallback.
// Query: accountTypeId, userId, symbols (comma-separated, e.g. from /prices/instruments)
router.get('/spreads', async (req, res) => {
  try {
    const userId = req.query.userId ? String(req.query.userId) : ''
    const accountTypeId = req.query.accountTypeId ? String(req.query.accountTypeId) : ''
    const fromClient = req.query.symbols
      ? String(req.query.symbols).split(',').map((x) => normInstrumentKey(x.trim())).filter(Boolean)
      : []
    const symbols = [...new Set([...fromClient, ...DEFAULT_SPREAD_SYMBOLS])]

    const allCharges = await Charges.find({ isActive: true }).sort({ createdAt: -1 })

    const atid = accountTypeId || null
    const spreadMap = {}

    for (const symbol of symbols) {
      const seg = resolveTradeSegment(symbol)
      const merged = await Charges.getChargesForTrade(userId, symbol, seg, atid, allCharges)
      const sv = merged.spreadValue > 0 ? merged.spreadValue : 0
      const st = merged.spreadType || 'FIXED'
      if (sv > 0) {
        spreadMap[normInstrumentKey(symbol)] = {
          spread: sv,
          spreadType: st,
          level: 'RESOLVED',
        }
      }
    }

    res.json({ success: true, spreads: spreadMap })
  } catch (error) {
    console.error('Error fetching spreads:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/charges/commissions — same merged commission lookup as tradeEngine.
// Admin-set Charges are the sole source; AccountType.commission is no longer a fallback.
// Query: accountTypeId, userId, symbols (comma-separated, e.g. from /prices/instruments)
router.get('/commissions', async (req, res) => {
  try {
    const userId = req.query.userId ? String(req.query.userId) : ''
    const accountTypeId = req.query.accountTypeId ? String(req.query.accountTypeId) : ''
    const fromClient = req.query.symbols
      ? String(req.query.symbols).split(',').map((x) => normInstrumentKey(x.trim())).filter(Boolean)
      : []
    const symbols = [...new Set([...fromClient, ...DEFAULT_SPREAD_SYMBOLS])]

    const allCharges = await Charges.find({ isActive: true }).sort({ createdAt: -1 })

    const atid = accountTypeId || null
    const commissionMap = {}

    for (const symbol of symbols) {
      const seg = resolveTradeSegment(symbol)
      const merged = await Charges.getChargesForTrade(userId, symbol, seg, atid, allCharges)
      const cv = merged.commissionValue > 0 ? merged.commissionValue : 0
      const ct = merged.commissionType || 'PER_LOT'
      if (cv > 0) {
        commissionMap[normInstrumentKey(symbol)] = {
          commission: cv,
          commissionType: ct,
          commissionOnBuy: merged.commissionOnBuy,
          commissionOnSell: merged.commissionOnSell,
          commissionOnClose: merged.commissionOnClose,
          level: 'RESOLVED',
        }
      }
    }

    res.json({ success: true, commissions: commissionMap })
  } catch (error) {
    console.error('Error fetching commissions map:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/charges - Get all charges with optional filters
router.get('/', async (req, res) => {
  try {
    const { segment, level, instrumentSymbol, userId } = req.query
    
    let query = { isActive: true }
    // Legacy ?segment=Forex hid INSTRUMENT rows with segment Metals/Crypto (e.g. XAUUSD). Those levels
    // are keyed by symbol, not segment filter — always include them when segment filter is used.
    if (segment) {
      query.$or = [
        { segment: segment },
        { segment: null },
        { level: 'INSTRUMENT' },
        { level: 'USER' }
      ]
    }
    if (level) query.level = level
    if (instrumentSymbol) query.instrumentSymbol = instrumentSymbol
    if (userId) query.userId = userId

    const charges = await Charges.find(query)
      .populate('userId', 'name email mobile')
      .sort({ level: 1, createdAt: -1 })
    res.json({ success: true, charges })
  } catch (error) {
    console.error('Error fetching charges:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/charges/:id - Get single charge
router.get('/:id', async (req, res) => {
  try {
    const charge = await Charges.findById(req.params.id)
    if (!charge) {
      return res.status(404).json({ success: false, message: 'Charge not found' })
    }
    res.json({ success: true, charge })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/charges - Create new charge
router.post('/', async (req, res) => {
  try {
    const {
      level,
      userId,
      instrumentSymbol,
      segment,
      accountTypeId,
      spreadType,
      spreadValue,
      commissionType,
      commissionValue,
      commissionOnBuy,
      commissionOnSell,
      commissionOnClose,
      swapLong,
      swapShort,
      swapType
    } = req.body

    if (!level) {
      return res.status(400).json({ success: false, message: 'Level is required' })
    }

    const charge = await Charges.create({
      level,
      userId: userId || null,
      instrumentSymbol: instrumentSymbol || null,
      segment: segment || null,
      accountTypeId: accountTypeId || null,
      spreadType: spreadType || 'FIXED',
      spreadValue: spreadValue || 0,
      commissionType: commissionType || 'PER_LOT',
      commissionValue: commissionValue || 0,
      commissionOnBuy: commissionOnBuy !== false,
      commissionOnSell: commissionOnSell !== false,
      commissionOnClose: commissionOnClose || false,
      swapLong: swapLong || 0,
      swapShort: swapShort || 0,
      swapType: swapType || 'POINTS',
      isActive: true
    })

    // Sync spread to AccountType if this is an ACCOUNT_TYPE level charge
    if (level === 'ACCOUNT_TYPE' && accountTypeId && spreadValue > 0) {
      await AccountType.findByIdAndUpdate(accountTypeId, { 
        minSpread: spreadValue,
        commission: commissionValue || 0
      })
      console.log(`Synced spread ${spreadValue} and commission ${commissionValue || 0} to AccountType ${accountTypeId}`)
    }

    emitChargesUpdated(req, { action: 'create', chargeId: String(charge._id) })
    res.json({ success: true, message: 'Charge created', charge })
  } catch (error) {
    console.error('Error creating charge:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/charges/:id - Update charge
router.put('/:id', async (req, res) => {
  try {
    const {
      level,
      userId,
      instrumentSymbol,
      segment,
      accountTypeId,
      spreadType,
      spreadValue,
      commissionType,
      commissionValue,
      commissionOnBuy,
      commissionOnSell,
      commissionOnClose,
      swapLong,
      swapShort,
      swapType,
      isActive
    } = req.body

    const charge = await Charges.findById(req.params.id)
    if (!charge) {
      return res.status(404).json({ success: false, message: 'Charge not found' })
    }

    if (level !== undefined) charge.level = level
    if (userId !== undefined) charge.userId = userId || null
    if (instrumentSymbol !== undefined) charge.instrumentSymbol = instrumentSymbol || null
    if (segment !== undefined) charge.segment = segment || null
    if (accountTypeId !== undefined) charge.accountTypeId = accountTypeId || null
    if (spreadType !== undefined) charge.spreadType = spreadType
    if (spreadValue !== undefined) charge.spreadValue = spreadValue
    if (commissionType !== undefined) charge.commissionType = commissionType
    if (commissionValue !== undefined) charge.commissionValue = commissionValue
    if (commissionOnBuy !== undefined) charge.commissionOnBuy = commissionOnBuy
    if (commissionOnSell !== undefined) charge.commissionOnSell = commissionOnSell
    if (commissionOnClose !== undefined) charge.commissionOnClose = commissionOnClose
    if (swapLong !== undefined) charge.swapLong = swapLong
    if (swapShort !== undefined) charge.swapShort = swapShort
    if (swapType !== undefined) charge.swapType = swapType
    if (isActive !== undefined) charge.isActive = isActive

    await charge.save()

    // Sync spread to AccountType if this is an ACCOUNT_TYPE level charge
    if (charge.level === 'ACCOUNT_TYPE' && charge.accountTypeId) {
      const updateData = {}
      if (charge.spreadValue > 0) updateData.minSpread = charge.spreadValue
      if (charge.commissionValue > 0) updateData.commission = charge.commissionValue
      
      if (Object.keys(updateData).length > 0) {
        await AccountType.findByIdAndUpdate(charge.accountTypeId, updateData)
        console.log(`Synced spread/commission to AccountType ${charge.accountTypeId}:`, updateData)
      }
    }

    emitChargesUpdated(req, { action: 'update', chargeId: String(charge._id) })
    res.json({ success: true, message: 'Charge updated', charge })
  } catch (error) {
    console.error('Error updating charge:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/charges/:id - Delete charge
router.delete('/:id', async (req, res) => {
  try {
    const charge = await Charges.findById(req.params.id)
    if (!charge) {
      return res.status(404).json({ success: false, message: 'Charge not found' })
    }

    await Charges.findByIdAndDelete(req.params.id)
    emitChargesUpdated(req, { action: 'delete', chargeId: String(req.params.id) })
    res.json({ success: true, message: 'Charge deleted' })
  } catch (error) {
    console.error('Error deleting charge:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
