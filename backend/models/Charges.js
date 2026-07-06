import mongoose from 'mongoose'

function normSymbol(s) {
  if (s == null || s === '') return ''
  return String(s).toUpperCase().trim()
}

// Robust ID equality — handles populated objects ({_id, name}), bare ObjectIds, and strings.
function sameId(a, b) {
  const norm = (v) => {
    if (v == null || v === '') return ''
    if (typeof v === 'object' && v._id != null) return String(v._id)
    return String(v)
  }
  const aa = norm(a)
  const bb = norm(b)
  return aa !== '' && bb !== '' && aa === bb
}

const chargesSchema = new mongoose.Schema({
  // Hierarchy level - higher priority overrides lower
  // Priority: USER > INSTRUMENT > SEGMENT > ACCOUNT_TYPE > GLOBAL
  level: {
    type: String,
    enum: ['USER', 'INSTRUMENT', 'SEGMENT', 'ACCOUNT_TYPE', 'GLOBAL'],
    required: true
  },
  // Reference IDs based on level
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  instrumentSymbol: {
    type: String,
    default: null
  },
  segment: {
    type: String,
    enum: ['Forex', 'Crypto', 'Commodities', 'Indices', 'Metals', null],
    default: null
  },
  accountTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AccountType',
    default: null
  },
  
  // ============ SPREAD SETTINGS ============
  // Spread is added to the price (BUY gets higher price, SELL gets lower price)
  // For Forex: Value in PIPS (e.g., 1.5 = 1.5 pips = 0.00015 for EURUSD, 0.015 for USDJPY)
  // For Metals: Value in cents (e.g., 50 = $0.50 for XAUUSD)
  // For Crypto: Value in USD (e.g., 10 = $10 spread)
  spreadType: {
    type: String,
    enum: ['FIXED', 'PERCENTAGE'],
    default: 'FIXED'
  },
  spreadValue: {
    type: Number,
    default: 0
  },
  
  // ============ COMMISSION SETTINGS ============
  // Commission charged per lot on each execution (buy/sell/close)
  commissionType: {
    type: String,
    enum: ['PER_LOT', 'PER_TRADE', 'PERCENTAGE'],
    default: 'PER_LOT'
  },
  commissionValue: {
    type: Number,
    default: 0
  },
  // When to charge commission
  commissionOnBuy: {
    type: Boolean,
    default: true
  },
  commissionOnSell: {
    type: Boolean,
    default: true
  },
  commissionOnClose: {
    type: Boolean,
    default: false
  },
  
  // ============ SWAP SETTINGS ============
  // Overnight fees (charged daily at rollover time)
  swapLong: {
    type: Number,
    default: 0
  },
  swapShort: {
    type: Number,
    default: 0
  },
  swapType: {
    type: String,
    enum: ['POINTS', 'PERCENTAGE'],
    default: 'POINTS'
  },
  
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true })

// Merges charges from multiple levels - most specific wins for each field
// preloadedCharges: optional array from a single find() — avoids N DB round-trips when resolving many symbols
chargesSchema.statics.getChargesForTrade = async function(userId, symbol, segment, accountTypeId, preloadedCharges) {
  const symNorm = normSymbol(symbol)
  console.log(`Getting charges for: userId=${userId}, symbol=${symbol} (${symNorm}), segment=${segment}, accountTypeId=${accountTypeId}`)
  
  const allCharges = Array.isArray(preloadedCharges)
    ? preloadedCharges
    : await this.find({ isActive: true }).sort({ createdAt: -1 })
  
  // Filter charges that apply to this trade
  let applicableCharges = allCharges.filter(charge => {
    // USER level - must match userId
    if (charge.level === 'USER') {
      if (!charge.userId || !sameId(charge.userId, userId)) return false
      // If instrument is specified, must match
      if (charge.instrumentSymbol && normSymbol(charge.instrumentSymbol) !== symNorm) return false
      return true
    }

    // INSTRUMENT level - must match symbol
    if (charge.level === 'INSTRUMENT') {
      if (normSymbol(charge.instrumentSymbol) !== symNorm) return false
      // If accountTypeId is specified, must match
      if (charge.accountTypeId && !sameId(charge.accountTypeId, accountTypeId)) return false
      return true
    }

    // ACCOUNT_TYPE level - must match accountTypeId
    if (charge.level === 'ACCOUNT_TYPE') {
      if (!charge.accountTypeId || !sameId(charge.accountTypeId, accountTypeId)) return false
      // If segment is specified, must match
      if (charge.segment && charge.segment !== segment) return false
      return true
    }
    
    // SEGMENT level - must match segment OR be null (applies to all segments)
    if (charge.level === 'SEGMENT') {
      if (charge.segment && charge.segment !== segment) return false
      return true
    }
    
    // GLOBAL level - always applies
    if (charge.level === 'GLOBAL') {
      return true
    }
    
    return false
  })
  
  // Merge charges at the same level - combine non-zero values from multiple charges
  const chargesByLevel = {}
  for (const charge of applicableCharges) {
    const key = `${charge.level}-${charge.segment || ''}-${charge.instrumentSymbol || ''}-${charge.accountTypeId || ''}`
    const existing = chargesByLevel[key]
    
    if (!existing) {
      // Clone the charge object to avoid modifying the original
      chargesByLevel[key] = { ...charge.toObject ? charge.toObject() : charge }
    } else {
      // Merge non-zero values from this charge into existing
      if (charge.commissionValue > 0 && !existing.commissionValue) {
        existing.commissionValue = charge.commissionValue
        existing.commissionType = charge.commissionType
        existing.commissionOnBuy = charge.commissionOnBuy
        existing.commissionOnSell = charge.commissionOnSell
        existing.commissionOnClose = charge.commissionOnClose
      }
      if (charge.spreadValue > 0 && !existing.spreadValue) {
        existing.spreadValue = charge.spreadValue
        existing.spreadType = charge.spreadType
      }
      if ((charge.swapLong !== 0 || charge.swapShort !== 0) && !existing.swapLong && !existing.swapShort) {
        existing.swapLong = charge.swapLong
        existing.swapShort = charge.swapShort
        existing.swapType = charge.swapType
      }
    }
  }
  
  applicableCharges = Object.values(chargesByLevel)
  console.log(`Found ${applicableCharges.length} applicable charges after merging`)
  
  // Priority order for merging
  const priorityOrder = { 'USER': 1, 'INSTRUMENT': 2, 'ACCOUNT_TYPE': 3, 'SEGMENT': 4, 'GLOBAL': 5 }

  // Tie-break: within the same level, prefer charges scoped to this account type
  // (e.g. INSTRUMENT+accountTypeId beats plain INSTRUMENT). Without this, the order
  // depends on createdAt and account-type-specific commissions can be silently shadowed.
  const matchesAccountType = (c) => sameId(c.accountTypeId, accountTypeId)

  // Sort by priority (most specific first), then by account-type specificity within the same level
  applicableCharges.sort((a, b) => {
    const dp = priorityOrder[a.level] - priorityOrder[b.level]
    if (dp !== 0) return dp
    const aMatch = matchesAccountType(a) ? 1 : 0
    const bMatch = matchesAccountType(b) ? 1 : 0
    return bMatch - aMatch
  })
  
  // Merge charges - most specific wins for each field
  const result = {
    spreadType: 'FIXED',
    spreadValue: 0,
    commissionType: 'PER_LOT',
    commissionValue: 0,
    commissionOnBuy: true,
    commissionOnSell: true,
    commissionOnClose: false,
    swapLong: 0,
    swapShort: 0,
    swapType: 'POINTS'
  }
  
  // Apply charges from least specific to most specific (so most specific overwrites)
  // Track which fields have been explicitly set by higher priority charges
  const explicitlySet = { spread: false, commission: false, swap: false }
  
  // Apply from most specific to least specific
  for (let i = 0; i < applicableCharges.length; i++) {
    const charge = applicableCharges[i]
    
    // Spread: If not already set by higher priority, apply this charge's spread
    // spreadValue can be 0 (admin explicitly wants no spread) or > 0
    if (!explicitlySet.spread && charge.spreadValue !== undefined && charge.spreadValue !== null) {
      result.spreadValue = charge.spreadValue
      result.spreadType = charge.spreadType || 'FIXED'
      explicitlySet.spread = true
    }
    
    // Commission: Same logic - 0 means no commission
    if (!explicitlySet.commission && charge.commissionValue !== undefined && charge.commissionValue !== null) {
      result.commissionValue = charge.commissionValue
      result.commissionType = charge.commissionType || 'PER_LOT'
      result.commissionOnBuy = charge.commissionOnBuy !== undefined ? charge.commissionOnBuy : true
      result.commissionOnSell = charge.commissionOnSell !== undefined ? charge.commissionOnSell : true
      result.commissionOnClose = charge.commissionOnClose !== undefined ? charge.commissionOnClose : false
      explicitlySet.commission = true
    }
    
    // Swap: Same logic
    if (!explicitlySet.swap && (charge.swapLong !== undefined || charge.swapShort !== undefined)) {
      result.swapLong = charge.swapLong || 0
      result.swapShort = charge.swapShort || 0
      result.swapType = charge.swapType || 'POINTS'
      explicitlySet.swap = true
    }
  }
  
  console.log(`Final charges for ${symbol} (accountTypeId=${accountTypeId ? String(accountTypeId) : '∅'}): spread=${result.spreadValue}, commission=${result.commissionValue}, swapLong=${result.swapLong}, swapShort=${result.swapShort}`)

  return result
}

export default mongoose.model('Charges', chargesSchema)
