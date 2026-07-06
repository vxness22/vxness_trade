import User from '../models/User.js'
import IBPlan from '../models/IBPlanNew.js'
import IBCommission from '../models/IBCommissionNew.js'
import IBWallet from '../models/IBWallet.js'
import IBLevel from '../models/IBLevel.js'
import IBTierChangeRequest from '../models/IBTierChangeRequest.js'
import Trade from '../models/Trade.js'
import Charges from '../models/Charges.js'
import IBCommissionConfig from '../models/IBCommissionConfig.js'
import { resolveTradeSegment } from '../utils/tradeSegment.js'

class IBEngine {
  constructor() {
    this.CONTRACT_SIZES = {
      'XAUUSD': 100,
      'XAGUSD': 5000,
      'BTCUSD': 1,
      'ETHUSD': 1,
      'DEFAULT_FOREX': 100000,
      'DEFAULT_CRYPTO': 1
    }
  }

  getContractSize(symbol) {
    if (this.CONTRACT_SIZES[symbol]) return this.CONTRACT_SIZES[symbol]
    if (symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('USD')) {
      if (symbol.length <= 6) return this.CONTRACT_SIZES.DEFAULT_CRYPTO
    }
    return this.CONTRACT_SIZES.DEFAULT_FOREX
  }

  _calcChargeCommission(quantity, price, commissionType, commissionValue, contractSize) {
    const ct = String(commissionType || 'PER_LOT')
    const cv = Number(commissionValue) || 0
    if (cv <= 0) return 0
    if (ct === 'PER_LOT') return quantity * cv
    if (ct === 'PER_TRADE') return cv
    if (ct === 'PERCENTAGE') return quantity * contractSize * price * (cv / 100)
    return quantity * cv
  }

  /**
   * Gross pool for IB % split: open commission + close commission (if configured) + account-type fallback ($/lot).
   */
  async getGrossCommissionPoolForTrade(tradeId) {
    const t = await Trade.findById(tradeId).populate({
      path: 'tradingAccountId',
      populate: { path: 'accountTypeId' }
    })
    if (!t || t.status !== 'CLOSED') return { gross: 0, accountTypeId: null, skip: true }
    if (t.isChallengeAccount || t.accountType === 'ChallengeAccount') {
      return { gross: 0, accountTypeId: null, skip: true }
    }

    const account = t.tradingAccountId
    const at = account?.accountTypeId
    const accountTypeId = at?._id || null
    if (!accountTypeId) return { gross: t.commission || 0, accountTypeId: null, skip: false }

    const segment = resolveTradeSegment(t.symbol, t.segment)
    const charges = await Charges.getChargesForTrade(t.userId, t.symbol, segment, accountTypeId)

    let gross = Number(t.commission) || 0
    if (charges.commissionOnClose && charges.commissionValue > 0 && t.closePrice) {
      gross += this._calcChargeCommission(
        t.quantity,
        t.closePrice,
        charges.commissionType,
        charges.commissionValue,
        t.contractSize || this.getContractSize(t.symbol)
      )
    }

    if (gross <= 0 && at?.commission > 0) {
      gross = t.quantity * at.commission
    }

    return { gross, accountTypeId, skip: false }
  }

  // Generate unique referral code
  async generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let code
    let exists = true
    
    while (exists) {
      code = 'IB'
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      exists = await User.findOne({ referralCode: code })
    }
    
    return code
  }

  // Apply to become IB (optional requestedLevelId = commission tier Standard/Bronze/…)
  async applyForIB(userId, requestedLevelId = null) {
    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')

    const reapplyAfterReject = user.isIB && user.ibStatus === 'REJECTED'
    if (user.isIB && !reapplyAfterReject) {
      throw new Error('User is already an IB')
    }

    if (requestedLevelId) {
      const tier = await IBLevel.findOne({ _id: requestedLevelId, isActive: true })
      if (!tier) throw new Error('Invalid or inactive commission tier')
    }

    const referralCode = await this.generateReferralCode()

    user.isIB = true
    user.ibStatus = 'PENDING'
    user.referralCode = referralCode
    user.ibRejectionReason = null
    user.ibPlanId = null
    user.ibLevelId = null
    user.ibLevelOrder = 1

    // If user was referred by an IB, set parent and level
    if (user.referredBy) {
      const parentIB = await User.findOne({ 
        referralCode: user.referredBy, 
        isIB: true, 
        ibStatus: 'ACTIVE' 
      })
      if (parentIB) {
        user.parentIBId = parentIB._id
        user.ibLevel = parentIB.ibLevel + 1
      } else {
        user.ibLevel = 1
      }
    } else {
      user.ibLevel = 1
    }

    await user.save()
    
    // Create IB wallet
    await IBWallet.getOrCreateWallet(userId)

    await IBTierChangeRequest.updateMany(
      { userId, requestType: 'APPLICATION', status: 'PENDING' },
      { $set: { status: 'REJECTED', rejectionReason: 'Replaced by new application', reviewedAt: new Date() } }
    )

    if (requestedLevelId) {
      await IBTierChangeRequest.create({
        userId,
        requestType: 'APPLICATION',
        requestedLevelId,
        status: 'PENDING'
      })
    }
    
    return user
  }

  // Admin approve IB (optional explicitLevelId overrides pending APPLICATION tier)
  async approveIB(userId, planId = null, explicitLevelId = null) {
    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')
    if (!user.isIB) throw new Error('User is not an IB applicant')

    user.ibStatus = 'ACTIVE'
    
    if (planId) {
      user.ibPlanId = planId
    } else {
      const defaultPlan = await IBPlan.getDefaultPlan()
      user.ibPlanId = defaultPlan._id
    }

    let levelApplied = false
    const explicit = explicitLevelId ? await IBLevel.findOne({ _id: explicitLevelId, isActive: true }) : null
    if (explicit) {
      user.ibLevelId = explicit._id
      user.ibLevelOrder = explicit.order
      levelApplied = true
      await IBTierChangeRequest.updateMany(
        { userId, requestType: 'APPLICATION', status: 'PENDING' },
        { $set: { status: 'REJECTED', rejectionReason: 'Admin assigned tier from panel', reviewedAt: new Date() } }
      )
    }

    if (!levelApplied) {
      const appReq = await IBTierChangeRequest.findOne({
        userId,
        requestType: 'APPLICATION',
        status: 'PENDING'
      })
      if (appReq) {
        const lvl = await IBLevel.findOne({ _id: appReq.requestedLevelId, isActive: true })
        if (lvl) {
          user.ibLevelId = lvl._id
          user.ibLevelOrder = lvl.order
          levelApplied = true
          appReq.status = 'APPROVED'
        } else {
          appReq.status = 'REJECTED'
          appReq.rejectionReason = 'Requested tier is no longer available'
        }
        appReq.reviewedAt = new Date()
        await appReq.save()
      }
    }

    if (!levelApplied) {
      await IBLevel.initializeDefaultLevels()
      const firstLevel = await IBLevel.findOne({ order: 1, isActive: true })
      if (firstLevel) {
        user.ibLevelId = firstLevel._id
        user.ibLevelOrder = firstLevel.order
      }
    }

    await user.save()
    return user
  }

  async rejectPendingApplicationTierRequests(userId, reason = 'IB application rejected') {
    await IBTierChangeRequest.updateMany(
      { userId, requestType: 'APPLICATION', status: 'PENDING' },
      { $set: { status: 'REJECTED', rejectionReason: reason, reviewedAt: new Date() } }
    )
  }

  async requestIbTierChange(ibUserId, requestedLevelId) {
    const user = await User.findById(ibUserId)
    if (!user || !user.isIB || user.ibStatus !== 'ACTIVE') {
      throw new Error('Only active IBs can request a tier change')
    }

    const target = await IBLevel.findOne({ _id: requestedLevelId, isActive: true })
    if (!target) throw new Error('Invalid or inactive tier')

    const currentId = user.ibLevelId?.toString() || null
    if (currentId && currentId === target._id.toString()) {
      throw new Error('You are already on this tier')
    }

    const dup = await IBTierChangeRequest.findOne({
      userId: ibUserId,
      requestType: 'LEVEL_CHANGE',
      status: 'PENDING'
    })
    if (dup) throw new Error('You already have a pending tier change request')

    return IBTierChangeRequest.create({
      userId: ibUserId,
      requestType: 'LEVEL_CHANGE',
      requestedLevelId: target._id,
      previousLevelId: user.ibLevelId || null,
      status: 'PENDING'
    })
  }

  async getPendingTierRequestForUser(userId) {
    const r = await IBTierChangeRequest.findOne({
      userId,
      status: 'PENDING',
      requestType: 'LEVEL_CHANGE'
    }).populate('requestedLevelId', 'name order commissionRate color icon referralTarget')

    if (!r) return null
    return {
      _id: r._id,
      requestType: r.requestType,
      requestedLevel: r.requestedLevelId,
      createdAt: r.createdAt
    }
  }

  async approveTierChangeRequest(requestId) {
    const reqDoc = await IBTierChangeRequest.findById(requestId)
    if (!reqDoc || reqDoc.status !== 'PENDING') {
      throw new Error('Request not found or already processed')
    }
    if (reqDoc.requestType === 'APPLICATION') {
      throw new Error('Application tier is applied when you approve the IB from Applications')
    }

    const level = await IBLevel.findOne({ _id: reqDoc.requestedLevelId, isActive: true })
    if (!level) throw new Error('Requested tier no longer exists or is inactive')

    const user = await User.findById(reqDoc.userId)
    if (!user || !user.isIB || user.ibStatus !== 'ACTIVE') {
      throw new Error('User is not an active IB')
    }

    user.ibLevelId = level._id
    user.ibLevelOrder = level.order
    await user.save()

    reqDoc.status = 'APPROVED'
    reqDoc.reviewedAt = new Date()
    await reqDoc.save()

    return { user, level, request: reqDoc }
  }

  async rejectTierChangeRequest(requestId, reason = '') {
    const reqDoc = await IBTierChangeRequest.findById(requestId)
    if (!reqDoc || reqDoc.status !== 'PENDING') {
      throw new Error('Request not found or already processed')
    }
    reqDoc.status = 'REJECTED'
    reqDoc.rejectionReason = reason || 'Rejected by admin'
    reqDoc.reviewedAt = new Date()
    await reqDoc.save()
    return reqDoc
  }

  // Admin block IB
  async blockIB(userId, reason = '') {
    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')

    user.ibStatus = 'BLOCKED'
    await user.save()
    return user
  }

  // Register user with referral code
  async registerWithReferral(userId, referralCode) {
    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')

    const referringIB = await User.findOne({ 
      referralCode, 
      isIB: true, 
      ibStatus: 'ACTIVE' 
    })
    
    if (!referringIB) {
      throw new Error('Invalid or inactive referral code')
    }

    user.referredBy = referralCode
    user.parentIBId = referringIB._id
    await user.save()

    return { user, referringIB }
  }

  // Get IB chain for a trader (upline IBs)
  async getIBChain(userId, maxLevels = 5) {
    const chain = []
    let currentUser = await User.findById(userId)
    
    if (!currentUser) return chain

    let parentId = currentUser.parentIBId
    let level = 1

    while (parentId && level <= maxLevels) {
      const parentIB = await User.findById(parentId)
        .populate('ibPlanId')
      
      if (!parentIB || !parentIB.isIB || parentIB.ibStatus !== 'ACTIVE') {
        break
      }

      chain.push({
        ibUser: parentIB,
        level
      })

      parentId = parentIB.parentIBId
      level++
    }

    return chain
  }

  // Calculate and distribute IB commission when a trade closes
  async processTradeCommission(trade) {
    console.log(`Processing IB commission for trade ${trade.tradeId || trade._id}, userId: ${trade.userId}`)

    const pool = await this.getGrossCommissionPoolForTrade(trade._id)
    if (pool.skip) {
      return { processed: false, reason: 'IB commission not applied (challenge or invalid trade)' }
    }

    if (pool.accountTypeId) {
      const configs = await IBCommissionConfig.getOrderedForAccountType(pool.accountTypeId)
      const hasPayable = configs.some((c) => c.isActive && c.commissionPercent > 0)
      if (configs.length > 0 && hasPayable) {
        return this.processTradeCommissionByAccountTypeConfig(trade, pool.gross, pool.accountTypeId, configs)
      }
    }

    return this.processTradeCommissionLegacy(trade)
  }

  /**
   * Spec: % of gross commission pool per chain level, keyed by trader's account type.
   */
  async processTradeCommissionByAccountTypeConfig(trade, grossCommission, accountTypeId, configs) {
    const ibChain = await this.getIBChain(trade.userId)
    if (ibChain.length === 0) {
      return { processed: false, reason: 'No IB chain found for trader', mode: 'ACCOUNT_TYPE_GROSS_PERCENT' }
    }

    const commissionResults = []
    const contractSize = this.getContractSize(trade.symbol)
    const baseAmount = trade.quantity

    for (const { ibUser, level } of ibChain) {
      const cfg = configs.find((c) => c.level === level)
      if (!cfg || !cfg.isActive || cfg.commissionPercent <= 0) {
        console.log(`[IB %] No active config for chain level ${level}, stopping cascade`)
        break
      }

      try {
        const commissionAmount = grossCommission * (cfg.commissionPercent / 100)
        if (commissionAmount <= 0) continue

        const existingCommission = await IBCommission.findOne({
          tradeId: trade._id,
          ibUserId: ibUser._id,
          level
        })
        if (existingCommission) continue

        const commission = await IBCommission.create({
          tradeId: trade._id,
          traderUserId: trade.userId,
          ibUserId: ibUser._id,
          level,
          baseAmount,
          commissionAmount,
          symbol: trade.symbol,
          tradeLotSize: trade.quantity,
          contractSize,
          commissionType: 'PERCENT',
          distributionMode: 'ACCOUNT_TYPE_GROSS_PERCENT',
          accountTypeId,
          grossCommissionPool: grossCommission,
          commissionPercentApplied: cfg.commissionPercent,
          status: 'CREDITED'
        })

        const wallet = await IBWallet.getOrCreateWallet(ibUser._id)
        await wallet.creditCommission(commissionAmount)

        commissionResults.push({
          ibUserId: ibUser._id,
          ibName: ibUser.firstName,
          level,
          commissionAmount,
          commissionId: commission._id,
          percent: cfg.commissionPercent
        })

        console.log(
          `[IB %] Level ${level} ${ibUser.firstName}: ${cfg.commissionPercent}% of $${grossCommission.toFixed(2)} = $${commissionAmount.toFixed(2)}`
        )
      } catch (error) {
        console.error(`Error processing IB % commission for level ${level}:`, error)
      }
    }

    const totalPct = configs.filter((c) => c.isActive).reduce((s, c) => s + c.commissionPercent, 0)
    const platformRemainder = Math.max(0, grossCommission - commissionResults.reduce((s, r) => s + r.commissionAmount, 0))
    console.log(
      `[IB %] Trade ${trade.tradeId}: gross=$${grossCommission.toFixed(2)}, paid IBs=$${(grossCommission - platformRemainder).toFixed(2)}, platform~=$${platformRemainder.toFixed(2)} (config levels sum ${totalPct}%)`
    )

    return {
      processed: true,
      mode: 'ACCOUNT_TYPE_GROSS_PERCENT',
      grossCommission,
      commissionsGenerated: commissionResults.length,
      results: commissionResults
    }
  }

  /** Legacy: each IB's IBPlan (PER_LOT or % of notional) */
  async processTradeCommissionLegacy(trade) {
    console.log(`Processing IB commission (legacy plan) for trade ${trade.tradeId || trade._id}`)

    const ibChain = await this.getIBChain(trade.userId)

    if (ibChain.length === 0) {
      console.log('No IB chain found for trader')
      return { processed: false, reason: 'No IB chain found for trader', mode: 'LEGACY_PLAN' }
    }

    const commissionResults = []
    const contractSize = this.getContractSize(trade.symbol)

    for (const { ibUser, level } of ibChain) {
      try {
        console.log(`Processing level ${level} for IB ${ibUser.firstName} (${ibUser._id})`)

        let plan = await IBPlan.findById(ibUser.ibPlanId)
        if (!plan) {
          plan = await IBPlan.getDefaultPlan()
        }
        if (!plan) {
          console.log(`No plan found for IB ${ibUser.firstName}`)
          continue
        }

        if (level > plan.maxLevels) {
          console.log(`Level ${level} exceeds maxLevels ${plan.maxLevels}`)
          continue
        }

        let rate = 0
        if (plan.levelCommissions && plan.levelCommissions[`level${level}`]) {
          rate = plan.levelCommissions[`level${level}`]
        } else if (plan.levels && plan.levels.length > 0) {
          const levelConfig = plan.levels.find((l) => l.level === level)
          rate = levelConfig ? levelConfig.rate : 0
        } else if (plan.getRateForLevel) {
          rate = plan.getRateForLevel(level)
        }

        if (rate <= 0) continue

        let commissionAmount = 0
        const baseAmount = trade.quantity

        if (plan.commissionType === 'PER_LOT') {
          commissionAmount = trade.quantity * rate
        } else {
          const tradeValue = trade.quantity * contractSize * (trade.openPrice || 0)
          commissionAmount = tradeValue * (rate / 100)
        }

        if (commissionAmount <= 0) continue

        const existingCommission = await IBCommission.findOne({
          tradeId: trade._id,
          ibUserId: ibUser._id,
          level
        })

        if (existingCommission) continue

        const commission = await IBCommission.create({
          tradeId: trade._id,
          traderUserId: trade.userId,
          ibUserId: ibUser._id,
          level,
          baseAmount,
          commissionAmount,
          symbol: trade.symbol,
          tradeLotSize: trade.quantity,
          contractSize,
          commissionType: plan.commissionType,
          distributionMode: 'LEGACY_PLAN',
          status: 'CREDITED'
        })

        const wallet = await IBWallet.getOrCreateWallet(ibUser._id)
        await wallet.creditCommission(commissionAmount)

        commissionResults.push({
          ibUserId: ibUser._id,
          ibName: ibUser.firstName,
          level,
          baseAmount,
          commissionAmount,
          commissionId: commission._id
        })

        console.log(`IB Commission (legacy): Level ${level} IB ${ibUser.firstName} earned $${commissionAmount.toFixed(2)}`)
      } catch (error) {
        console.error(`Error processing IB commission for level ${level}:`, error)
      }
    }

    return {
      processed: true,
      mode: 'LEGACY_PLAN',
      commissionsGenerated: commissionResults.length,
      results: commissionResults
    }
  }

  // Reverse commission (admin action)
  async reverseCommission(commissionId, adminId, reason = '') {
    const commission = await IBCommission.findById(commissionId)
    if (!commission) throw new Error('Commission not found')
    if (commission.status === 'REVERSED') throw new Error('Commission already reversed')

    // Deduct from IB wallet
    const wallet = await IBWallet.getOrCreateWallet(commission.ibUserId)
    await wallet.reverseCommission(commission.commissionAmount)

    // Update commission status
    commission.status = 'REVERSED'
    commission.reversedAt = new Date()
    commission.reversedBy = adminId
    commission.reversalReason = reason
    await commission.save()

    return commission
  }

  // Get IB tree using $graphLookup (for admin visualization)
  async getIBTree(ibId, maxDepth = 5) {
    const result = await User.aggregate([
      { $match: { _id: ibId } },
      {
        $graphLookup: {
          from: 'users',
          startWith: '$_id',
          connectFromField: '_id',
          connectToField: 'parentIBId',
          as: 'downlines',
          maxDepth: maxDepth - 1,
          depthField: 'level'
        }
      },
      {
        $project: {
          _id: 1,
          firstName: 1,
          email: 1,
          referralCode: 1,
          ibStatus: 1,
          ibLevel: 1,
          downlines: {
            _id: 1,
            firstName: 1,
            email: 1,
            referralCode: 1,
            ibStatus: 1,
            isIB: 1,
            parentIBId: 1,
            level: 1
          }
        }
      }
    ])

    return result[0] || null
  }

  // Get IB stats for admin dashboard
  async getIBStats(ibUserId) {
    const user = await User.findById(ibUserId)
    if (!user || !user.isIB) throw new Error('IB not found')

    // Get wallet
    const wallet = await IBWallet.getOrCreateWallet(ibUserId)

    // Get direct referrals count
    const directReferrals = await User.countDocuments({ parentIBId: ibUserId })

    // Get total downline count (all levels)
    const tree = await this.getIBTree(user._id, 5)
    const totalDownline = tree?.downlines?.length || 0

    // Get commission stats
    const commissionStats = await IBCommission.aggregate([
      { $match: { ibUserId: user._id, status: 'CREDITED' } },
      {
        $group: {
          _id: null,
          totalCommission: { $sum: '$commissionAmount' },
          totalTrades: { $sum: 1 }
        }
      }
    ])

    // Get active traders (users who traded in last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const activeTraders = await IBCommission.aggregate([
      { 
        $match: { 
          ibUserId: user._id, 
          createdAt: { $gte: thirtyDaysAgo } 
        } 
      },
      { $group: { _id: '$traderUserId' } },
      { $count: 'count' }
    ])

    // Get commission counts per level
    const levelCommissions = await IBCommission.aggregate([
      { $match: { ibUserId: user._id, status: 'CREDITED' } },
      {
        $group: {
          _id: '$level',
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ])

    // Build level counts object
    const levelCounts = {}
    for (let i = 1; i <= 5; i++) {
      const levelData = levelCommissions.find(l => l._id === i)
      levelCounts[`level${i}Count`] = levelData?.count || 0
      levelCounts[`level${i}Commission`] = levelData?.totalAmount || 0
    }

    return {
      ibUser: {
        _id: user._id,
        firstName: user.firstName,
        email: user.email,
        referralCode: user.referralCode,
        ibStatus: user.ibStatus,
        ibLevel: user.ibLevel
      },
      wallet: {
        balance: wallet.balance,
        totalEarned: wallet.totalEarned,
        totalWithdrawn: wallet.totalWithdrawn,
        pendingWithdrawal: wallet.pendingWithdrawal
      },
      stats: {
        directReferrals,
        totalDownline,
        totalCommission: commissionStats[0]?.totalCommission || 0,
        totalTrades: commissionStats[0]?.totalTrades || 0,
        activeTraders: activeTraders[0]?.count || 0,
        ...levelCounts
      }
    }
  }

  // Withdraw from IB wallet to main wallet
  async withdrawToWallet(ibUserId, amount) {
    const user = await User.findById(ibUserId)
    if (!user || !user.isIB) throw new Error('IB not found')

    const wallet = await IBWallet.getOrCreateWallet(ibUserId)
    
    if (amount > wallet.balance) {
      throw new Error('Insufficient IB wallet balance')
    }

    // Deduct from IB wallet
    await wallet.requestWithdrawal(amount)
    
    // Add to user's main wallet balance
    user.walletBalance = (user.walletBalance || 0) + amount
    await user.save()

    // Complete the withdrawal
    await wallet.completeWithdrawal(amount)

    return {
      ibWalletBalance: wallet.balance,
      mainWalletBalance: user.walletBalance,
      withdrawnAmount: amount
    }
  }

  // Check and auto-upgrade IB level based on referral count
  async checkAndUpgradeLevel(ibUserId) {
    const user = await User.findById(ibUserId).populate('ibLevelId')
    if (!user || !user.isIB || user.ibStatus !== 'ACTIVE') return null
    if (!user.autoUpgradeEnabled) return null

    // Get direct referral count
    const referralCount = await User.countDocuments({ parentIBId: ibUserId })
    
    // Get all levels sorted by order
    const levels = await IBLevel.getAllLevels()
    if (levels.length === 0) return null

    // Find the highest level the user qualifies for
    let qualifiedLevel = levels[0] // Start with lowest level
    for (const level of levels) {
      if (referralCount >= level.referralTarget) {
        qualifiedLevel = level
      }
    }

    // Check if upgrade is needed
    const currentLevelOrder = user.ibLevelOrder || 1
    if (qualifiedLevel.order > currentLevelOrder) {
      user.ibLevelId = qualifiedLevel._id
      user.ibLevelOrder = qualifiedLevel.order
      await user.save()
      
      console.log(`[IB Level] User ${user.firstName} upgraded to ${qualifiedLevel.name} (${referralCount} referrals)`)
      return {
        upgraded: true,
        previousLevel: currentLevelOrder,
        newLevel: qualifiedLevel,
        referralCount
      }
    }

    return { upgraded: false, currentLevel: qualifiedLevel, referralCount }
  }

  // Get IB level progress for user dashboard
  async getIBLevelProgress(ibUserId) {
    const user = await User.findById(ibUserId).populate('ibLevelId')
    if (!user || !user.isIB) throw new Error('IB not found')

    // Get direct referral count
    const referralCount = await User.countDocuments({ parentIBId: ibUserId })
    
    // Get all levels
    const levels = await IBLevel.getAllLevels()
    if (levels.length === 0) {
      // Initialize default levels if none exist
      await IBLevel.initializeDefaultLevels()
      const newLevels = await IBLevel.getAllLevels()
      return this._calculateLevelProgress(user, referralCount, newLevels)
    }

    return this._calculateLevelProgress(user, referralCount, levels)
  }

  _calculateLevelProgress(user, referralCount, levels) {
    // Find current level
    let currentLevel = levels.find(l => l.order === (user.ibLevelOrder || 1)) || levels[0]
    
    // Find next level
    const nextLevel = levels.find(l => l.order === currentLevel.order + 1)
    
    // Calculate progress
    let progressPercent = 100
    let referralsNeeded = 0
    
    if (nextLevel) {
      const currentTarget = currentLevel.referralTarget
      const nextTarget = nextLevel.referralTarget
      const range = nextTarget - currentTarget
      const progress = referralCount - currentTarget
      progressPercent = Math.min(100, Math.max(0, (progress / range) * 100))
      referralsNeeded = Math.max(0, nextTarget - referralCount)
    }

    return {
      currentLevel: {
        _id: currentLevel._id,
        name: currentLevel.name,
        order: currentLevel.order,
        commissionRate: currentLevel.commissionRate,
        commissionType: currentLevel.commissionType,
        color: currentLevel.color,
        icon: currentLevel.icon,
        referralTarget: currentLevel.referralTarget,
        downlineCommission: currentLevel.downlineCommission
      },
      nextLevel: nextLevel ? {
        _id: nextLevel._id,
        name: nextLevel.name,
        order: nextLevel.order,
        commissionRate: nextLevel.commissionRate,
        referralTarget: nextLevel.referralTarget,
        color: nextLevel.color
      } : null,
      referralCount,
      referralsNeeded,
      progressPercent: Math.round(progressPercent),
      autoUpgradeEnabled: user.autoUpgradeEnabled,
      allLevels: levels.map(l => ({
        _id: l._id,
        name: l.name,
        order: l.order,
        commissionRate: l.commissionRate,
        commissionType: l.commissionType,
        referralTarget: l.referralTarget,
        color: l.color,
        icon: l.icon,
        isCurrentLevel: l.order === currentLevel.order,
        isUnlocked: referralCount >= l.referralTarget
      }))
    }
  }

  // Assign initial level to new IB
  async assignInitialLevel(userId) {
    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')

    // Get the first level (Standard)
    let firstLevel = await IBLevel.findOne({ order: 1, isActive: true })
    if (!firstLevel) {
      await IBLevel.initializeDefaultLevels()
      firstLevel = await IBLevel.findOne({ order: 1, isActive: true })
    }

    if (firstLevel) {
      user.ibLevelId = firstLevel._id
      user.ibLevelOrder = firstLevel.order
      await user.save()
    }

    return user
  }
}

export default new IBEngine()
