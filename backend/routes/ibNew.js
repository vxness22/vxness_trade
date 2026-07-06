import express from 'express'
import User from '../models/User.js'
import IBPlan from '../models/IBPlanNew.js'
import IBCommission from '../models/IBCommissionNew.js'
import IBWallet from '../models/IBWallet.js'
import IBLevel from '../models/IBLevel.js'
import IBSettings from '../models/IBSettings.js'
import ibEngine from '../services/ibEngineNew.js'
import IBTierChangeRequest from '../models/IBTierChangeRequest.js'
import IBCommissionConfig from '../models/IBCommissionConfig.js'
import AccountType from '../models/AccountType.js'
import mongoose from 'mongoose'

const router = express.Router()

// ==================== USER ROUTES ====================

// POST /api/ib/apply - Apply to become an IB (optional requestedLevelId = commission tier)
router.post('/apply', async (req, res) => {
  try {
    const { userId, requestedLevelId } = req.body
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' })
    }

    const user = await ibEngine.applyForIB(userId, requestedLevelId || null)
    res.json({
      success: true,
      message: 'IB application submitted successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        isIB: user.isIB,
        ibStatus: user.ibStatus,
        referralCode: user.referralCode,
        ibLevel: user.ibLevel
      }
    })
  } catch (error) {
    console.error('Error applying for IB:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// POST /api/ib/register-referral - Register with referral code
router.post('/register-referral', async (req, res) => {
  try {
    const { userId, referralCode } = req.body
    if (!userId || !referralCode) {
      return res.status(400).json({ success: false, message: 'User ID and referral code are required' })
    }

    const result = await ibEngine.registerWithReferral(userId, referralCode)
    res.json({
      success: true,
      message: 'Referral registered successfully',
      referredBy: result.referringIB.firstName
    })
  } catch (error) {
    console.error('Error registering referral:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// GET /api/ib/my-profile/:userId - Get IB profile
router.get('/my-profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    
    // Validate userId
    if (!userId || userId === 'undefined' || userId === 'null') {
      return res.status(400).json({ success: false, message: 'Invalid user ID' })
    }
    
    const user = await User.findById(userId).populate('ibPlanId').populate('ibLevelId')
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    if (!user.isIB) {
      return res.json({ success: true, isIB: false })
    }

    const wallet = await IBWallet.getOrCreateWallet(userId)
    const stats = await ibEngine.getIBStats(userId)

    // Check for auto-upgrade before building level progress
    if (user.autoUpgradeEnabled) {
      await ibEngine.checkAndUpgradeLevel(userId)
    }

    const userFresh = await User.findById(userId).populate('ibPlanId').populate('ibLevelId')

    // Get level progress
    let levelProgress = null
    try {
      levelProgress = await ibEngine.getIBLevelProgress(userId)
    } catch (e) {
      console.error('Error getting level progress:', e)
    }

    let pendingTierRequest = null
    try {
      pendingTierRequest = await ibEngine.getPendingTierRequestForUser(userId)
    } catch (e) {
      console.error('Error getting pending tier request:', e)
    }

    let pendingApplicationTier = null
    if (userFresh.ibStatus === 'PENDING') {
      const appReq = await IBTierChangeRequest.findOne({
        userId,
        requestType: 'APPLICATION',
        status: 'PENDING'
      }).populate('requestedLevelId', 'name order commissionRate color')
      if (appReq?.requestedLevelId) {
        pendingApplicationTier = appReq.requestedLevelId
      }
    }

    res.json({
      success: true,
      isIB: true,
      ibUser: {
        _id: userFresh._id,
        firstName: userFresh.firstName,
        email: userFresh.email,
        referralCode: userFresh.referralCode,
        ibStatus: userFresh.ibStatus,
        ibLevel: userFresh.ibLevel,
        ibLevelOrder: userFresh.ibLevelOrder,
        ibLevelId: userFresh.ibLevelId,
        autoUpgradeEnabled: userFresh.autoUpgradeEnabled,
        ibPlan: userFresh.ibPlanId,
        ibRejectionReason: userFresh.ibRejectionReason,
        rejectionReason: userFresh.ibRejectionReason
      },
      wallet,
      stats: stats.stats,
      levelProgress,
      pendingTierRequest,
      pendingApplicationTier
    })
  } catch (error) {
    console.error('Error fetching IB profile:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/my-referrals/:userId - Get direct referrals
router.get('/my-referrals/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    
    const referrals = await User.find({ parentIBId: userId })
      .select('firstName email createdAt isIB ibStatus')
      .sort({ createdAt: -1 })

    res.json({ success: true, referrals })
  } catch (error) {
    console.error('Error fetching referrals:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/my-commissions/:userId - Get commission history
router.get('/my-commissions/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { limit = 50, offset = 0 } = req.query

    const commissions = await IBCommission.find({ ibUserId: userId })
      .populate('traderUserId', 'firstName email')
      .populate('tradeId', 'tradeId symbol side')
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))

    const total = await IBCommission.countDocuments({ ibUserId: userId })

    res.json({ success: true, commissions, total })
  } catch (error) {
    console.error('Error fetching commissions:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/my-downline/:userId - Get downline tree
router.get('/my-downline/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { maxDepth = 5 } = req.query

    const tree = await ibEngine.getIBTree(
      new mongoose.Types.ObjectId(userId), 
      parseInt(maxDepth)
    )

    res.json({ success: true, tree })
  } catch (error) {
    console.error('Error fetching downline:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/ib/withdraw - Withdraw to main wallet
router.post('/withdraw', async (req, res) => {
  try {
    const { userId, amount } = req.body
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid user ID and amount are required' })
    }

    const result = await ibEngine.withdrawToWallet(userId, parseFloat(amount))
    res.json({
      success: true,
      message: `Successfully withdrew $${amount} to main wallet`,
      ...result
    })
  } catch (error) {
    console.error('Error withdrawing:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// ==================== ADMIN ROUTES ====================

// GET /api/ib/admin/all - Get all IBs
router.get('/admin/all', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query

    let query = { isIB: true }
    if (status) query.ibStatus = status

    const ibs = await User.find(query)
      .populate('ibPlanId', 'name')
      .select('firstName email referralCode ibStatus ibLevel ibPlanId createdAt')
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))

    const total = await User.countDocuments(query)

    // Get wallet balances for each IB
    const ibsWithWallets = await Promise.all(ibs.map(async (ib) => {
      const wallet = await IBWallet.findOne({ ibUserId: ib._id })
      return {
        ...ib.toObject(),
        walletBalance: wallet?.balance || 0,
        totalEarned: wallet?.totalEarned || 0
      }
    }))

    res.json({ success: true, ibs: ibsWithWallets, total })
  } catch (error) {
    console.error('Error fetching IBs:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/admin/pending - Get pending IB applications
router.get('/admin/pending', async (req, res) => {
  try {
    const pendingUsers = await User.find({ isIB: true, ibStatus: 'PENDING' })
      .select('firstName lastName email referralCode ibLevel createdAt')
      .sort({ createdAt: -1 })

    const pending = await Promise.all(
      pendingUsers.map(async (u) => {
        const appReq = await IBTierChangeRequest.findOne({
          userId: u._id,
          requestType: 'APPLICATION',
          status: 'PENDING'
        }).populate('requestedLevelId', 'name order commissionRate')
        const o = u.toObject()
        o.requestedTier = appReq?.requestedLevelId || null
        return o
      })
    )

    res.json({ success: true, pending })
  } catch (error) {
    console.error('Error fetching pending IBs:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/admin/tier-change-requests — pending LEVEL_CHANGE queue
router.get('/admin/tier-change-requests', async (req, res) => {
  try {
    const { status = 'PENDING' } = req.query
    const q = { requestType: 'LEVEL_CHANGE' }
    if (status) q.status = status

    const requests = await IBTierChangeRequest.find(q)
      .populate('userId', 'firstName lastName email referralCode')
      .populate('requestedLevelId', 'name order commissionRate referralTarget color')
      .populate('previousLevelId', 'name order commissionRate')
      .sort({ createdAt: -1 })

    res.json({ success: true, requests })
  } catch (error) {
    console.error('Error fetching tier change requests:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/tier-change-requests/:requestId/approve
router.put('/admin/tier-change-requests/:requestId/approve', async (req, res) => {
  try {
    const { requestId } = req.params
    const result = await ibEngine.approveTierChangeRequest(requestId)
    res.json({
      success: true,
      message: `Tier updated to ${result.level.name}`,
      ...result
    })
  } catch (error) {
    console.error('Error approving tier request:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/tier-change-requests/:requestId/reject
router.put('/admin/tier-change-requests/:requestId/reject', async (req, res) => {
  try {
    const { requestId } = req.params
    const { reason } = req.body
    await ibEngine.rejectTierChangeRequest(requestId, reason)
    res.json({ success: true, message: 'Tier change request rejected' })
  } catch (error) {
    console.error('Error rejecting tier request:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// POST /api/ib/request-tier-change — active IB asks admin to change commission tier
router.post('/request-tier-change', async (req, res) => {
  try {
    const { userId, requestedLevelId } = req.body
    if (!userId || !requestedLevelId) {
      return res.status(400).json({ success: false, message: 'userId and requestedLevelId are required' })
    }
    const request = await ibEngine.requestIbTierChange(userId, requestedLevelId)
    res.json({
      success: true,
      message: 'Tier change request submitted. An admin will review it.',
      request
    })
  } catch (error) {
    console.error('Error requesting tier change:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/approve/:userId - Approve IB application
router.put('/admin/approve/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { planId, levelId } = req.body

    const user = await ibEngine.approveIB(userId, planId, levelId || null)
    res.json({
      success: true,
      message: 'IB approved successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        ibStatus: user.ibStatus,
        ibPlanId: user.ibPlanId
      }
    })
  } catch (error) {
    console.error('Error approving IB:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/reject/:userId - Reject IB application
router.put('/admin/reject/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { reason } = req.body

    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')

    user.ibStatus = 'REJECTED'
    user.ibRejectionReason = reason
    await user.save()

    await ibEngine.rejectPendingApplicationTierRequests(userId, reason || 'IB application rejected')

    res.json({
      success: true,
      message: 'IB application rejected',
      user: {
        _id: user._id,
        firstName: user.firstName,
        ibStatus: user.ibStatus
      }
    })
  } catch (error) {
    console.error('Error rejecting IB:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/block/:userId - Block IB
router.put('/admin/block/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { reason } = req.body

    const user = await ibEngine.blockIB(userId, reason)
    res.json({
      success: true,
      message: 'IB blocked successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        ibStatus: user.ibStatus
      }
    })
  } catch (error) {
    console.error('Error blocking IB:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/unblock/:userId - Unblock IB
router.put('/admin/unblock/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')

    user.ibStatus = 'ACTIVE'
    await user.save()

    res.json({
      success: true,
      message: 'IB unblocked successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        ibStatus: user.ibStatus
      }
    })
  } catch (error) {
    console.error('Error unblocking IB:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/update/:userId - Update IB details (level)
router.put('/admin/update/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { ibLevel } = req.body

    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')
    if (!user.isIB) throw new Error('User is not an IB')

    // Update IB level if provided
    if (ibLevel !== undefined) {
      user.ibLevel = parseInt(ibLevel) || 1
    }

    await user.save()

    res.json({
      success: true,
      message: 'IB updated successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        ibLevel: user.ibLevel
      }
    })
  } catch (error) {
    console.error('Error updating IB:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/change-plan/:userId - Change IB plan
router.put('/admin/change-plan/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { planId } = req.body

    const user = await User.findById(userId)
    if (!user || !user.isIB) throw new Error('IB not found')

    user.ibPlanId = planId
    await user.save()

    res.json({
      success: true,
      message: 'IB plan changed successfully'
    })
  } catch (error) {
    console.error('Error changing plan:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// GET /api/ib/admin/tree/:userId - Get IB tree for admin
router.get('/admin/tree/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { maxDepth = 5 } = req.query

    const tree = await ibEngine.getIBTree(
      new mongoose.Types.ObjectId(userId),
      parseInt(maxDepth)
    )

    res.json({ success: true, tree })
  } catch (error) {
    console.error('Error fetching IB tree:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/admin/stats/:userId - Get IB stats for admin
router.get('/admin/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const stats = await ibEngine.getIBStats(userId)
    res.json({ success: true, ...stats })
  } catch (error) {
    console.error('Error fetching IB stats:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/ib/admin/reverse-commission - Reverse a commission
router.post('/admin/reverse-commission', async (req, res) => {
  try {
    const { commissionId, adminId, reason } = req.body
    if (!commissionId || !adminId) {
      return res.status(400).json({ success: false, message: 'Commission ID and Admin ID are required' })
    }

    const commission = await ibEngine.reverseCommission(commissionId, adminId, reason)
    res.json({
      success: true,
      message: 'Commission reversed successfully',
      commission
    })
  } catch (error) {
    console.error('Error reversing commission:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// GET /api/ib/admin/commissions - Get all commissions
router.get('/admin/commissions', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query

    let query = {}
    if (status) query.status = status

    const commissions = await IBCommission.find(query)
      .populate('ibUserId', 'firstName email referralCode')
      .populate('traderUserId', 'firstName email')
      .populate('tradeId', 'tradeId symbol side quantity')
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))

    const total = await IBCommission.countDocuments(query)

    // Calculate totals
    const totals = await IBCommission.aggregate([
      { $match: { status: 'CREDITED' } },
      {
        $group: {
          _id: null,
          totalCommission: { $sum: '$commissionAmount' },
          totalTrades: { $sum: 1 }
        }
      }
    ])

    res.json({
      success: true,
      commissions,
      total,
      summary: {
        totalCommission: totals[0]?.totalCommission || 0,
        totalTrades: totals[0]?.totalTrades || 0
      }
    })
  } catch (error) {
    console.error('Error fetching commissions:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// ==================== PLAN ROUTES ====================

// GET /api/ib/plans - Get all active plans
router.get('/plans', async (req, res) => {
  try {
    const plans = await IBPlan.find({ isActive: true }).sort({ createdAt: -1 })
    res.json({ success: true, plans })
  } catch (error) {
    console.error('Error fetching plans:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/admin/plans - Get all plans (admin)
router.get('/admin/plans', async (req, res) => {
  try {
    const plans = await IBPlan.find().sort({ createdAt: -1 })
    
    // Transform plans to include levelCommissions format for frontend compatibility
    const transformedPlans = plans.map(plan => {
      const levelCommissions = {}
      if (plan.levels && Array.isArray(plan.levels)) {
        plan.levels.forEach(l => {
          levelCommissions[`level${l.level}`] = l.rate
        })
      }
      return {
        ...plan.toObject(),
        levelCommissions,
        commissionSources: plan.source
      }
    })
    
    res.json({ success: true, plans: transformedPlans })
  } catch (error) {
    console.error('Error fetching plans:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/ib/admin/plans - Create new plan
router.post('/admin/plans', async (req, res) => {
  try {
    const { name, description, maxLevels, commissionType, levelCommissions, commissionSources, minWithdrawalAmount, isDefault } = req.body

    if (!name) {
      return res.status(400).json({ success: false, message: 'Plan name is required' })
    }

    // Convert levelCommissions object to levels array for IBPlanNew.js compatibility
    const levels = []
    const lc = levelCommissions || { level1: 5, level2: 3, level3: 2, level4: 1, level5: 0.5 }
    for (let i = 1; i <= (maxLevels || 3); i++) {
      levels.push({ level: i, rate: lc[`level${i}`] || 0 })
    }

    const plan = await IBPlan.create({
      name,
      maxLevels: maxLevels || 3,
      commissionType: commissionType || 'PER_LOT',
      levels,
      source: commissionSources || { spread: true, tradeCommission: true, swap: false }
    })

    // If this is default, unset other defaults
    if (isDefault) {
      await IBPlan.updateMany(
        { _id: { $ne: plan._id } },
        { $set: { isDefault: false } }
      )
    }

    res.json({ success: true, message: 'Plan created successfully', plan })
  } catch (error) {
    console.error('Error creating plan:', error)
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A plan with this name already exists' })
    }
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/plans/:planId - Update plan
router.put('/admin/plans/:planId', async (req, res) => {
  try {
    const { planId } = req.params
    const { name, description, maxLevels, commissionType, levelCommissions, commissionSources, minWithdrawalAmount, isActive, isDefault } = req.body

    const plan = await IBPlan.findById(planId)
    if (!plan) throw new Error('Plan not found')

    if (name) plan.name = name
    if (description !== undefined) plan.description = description
    if (maxLevels) plan.maxLevels = maxLevels
    if (commissionType) plan.commissionType = commissionType
    if (levelCommissions) plan.levelCommissions = levelCommissions
    if (commissionSources) plan.commissionSources = commissionSources
    if (minWithdrawalAmount !== undefined) plan.minWithdrawalAmount = minWithdrawalAmount
    if (isActive !== undefined) plan.isActive = isActive
    if (isDefault !== undefined) plan.isDefault = isDefault

    await plan.save()

    // If this is default, unset other defaults
    if (isDefault) {
      await IBPlan.updateMany(
        { _id: { $ne: plan._id } },
        { $set: { isDefault: false } }
      )
    }

    res.json({ success: true, message: 'Plan updated successfully', plan })
  } catch (error) {
    console.error('Error updating plan:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// DELETE /api/ib/admin/plans/:planId - Delete plan
router.delete('/admin/plans/:planId', async (req, res) => {
  try {
    const { planId } = req.params
    
    // Check if any IBs are using this plan
    const ibsUsingPlan = await User.countDocuments({ ibPlanId: planId })
    if (ibsUsingPlan > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete plan. ${ibsUsingPlan} IBs are using this plan.` 
      })
    }

    await IBPlan.findByIdAndDelete(planId)
    res.json({ success: true, message: 'Plan deleted successfully' })
  } catch (error) {
    console.error('Error deleting plan:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// POST /api/ib/admin/transfer-referrals - Transfer users to a different IB
router.post('/admin/transfer-referrals', async (req, res) => {
  try {
    const { userIds, targetIBId } = req.body

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No users selected' })
    }

    if (!targetIBId) {
      return res.status(400).json({ success: false, message: 'Target IB not specified' })
    }

    // Find the target IB user
    const targetIB = await User.findById(targetIBId)
    if (!targetIB) {
      return res.status(404).json({ success: false, message: 'Target IB not found' })
    }

    // Verify target is an active IB
    if (!targetIB.isIB || targetIB.ibStatus !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'Target user is not an active IB' })
    }

    let transferredCount = 0

    // Update each user's parentIBId to point to new IB
    for (const userId of userIds) {
      try {
        const result = await User.findByIdAndUpdate(userId, { 
          parentIBId: targetIBId,
          referredBy: targetIB.referralCode
        }, { new: true })
        if (result) {
          transferredCount++
          console.log(`Transferred user ${userId} to IB ${targetIBId}`)
        }
      } catch (err) {
        console.error(`Error transferring user ${userId}:`, err)
      }
    }

    console.log(`[Admin] Transferred ${transferredCount} users to IB ${targetIB.email}`)

    res.json({ 
      success: true, 
      message: `Successfully transferred ${transferredCount} users`,
      transferredCount
    })
  } catch (error) {
    console.error('Error transferring referrals:', error)
    res.status(500).json({ success: false, message: 'Error transferring referrals', error: error.message })
  }
})

// GET /api/ib/admin/dashboard - Admin dashboard stats
router.get('/admin/dashboard', async (req, res) => {
  try {
    const totalIBs = await User.countDocuments({ isIB: true })
    const activeIBs = await User.countDocuments({ isIB: true, ibStatus: 'ACTIVE' })
    const pendingIBs = await User.countDocuments({ isIB: true, ibStatus: 'PENDING' })

    const commissionStats = await IBCommission.aggregate([
      { $match: { status: 'CREDITED' } },
      {
        $group: {
          _id: null,
          totalCommission: { $sum: '$commissionAmount' },
          totalTrades: { $sum: 1 }
        }
      }
    ])

    const walletStats = await IBWallet.aggregate([
      {
        $group: {
          _id: null,
          totalBalance: { $sum: '$balance' },
          totalEarned: { $sum: '$totalEarned' },
          totalWithdrawn: { $sum: '$totalWithdrawn' }
        }
      }
    ])

    res.json({
      success: true,
      stats: {
        totalIBs,
        activeIBs,
        pendingIBs,
        totalCommissionPaid: commissionStats[0]?.totalCommission || 0,
        totalTradesWithCommission: commissionStats[0]?.totalTrades || 0,
        totalIBWalletBalance: walletStats[0]?.totalBalance || 0,
        totalIBEarnings: walletStats[0]?.totalEarned || 0,
        totalIBWithdrawals: walletStats[0]?.totalWithdrawn || 0
      }
    })
  } catch (error) {
    console.error('Error fetching dashboard:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// ==================== IB LEVEL ROUTES ====================

// GET /api/ib/levels - Get all IB levels (public)
router.get('/levels', async (req, res) => {
  try {
    let levels = await IBLevel.getAllLevels()
    if (levels.length === 0) {
      await IBLevel.initializeDefaultLevels()
      levels = await IBLevel.getAllLevels()
    }
    res.json({ success: true, levels })
  } catch (error) {
    console.error('Error fetching levels:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/admin/levels - Get all IB levels (admin)
router.get('/admin/levels', async (req, res) => {
  try {
    let levels = await IBLevel.find().sort({ order: 1 })
    if (levels.length === 0) {
      await IBLevel.initializeDefaultLevels()
      levels = await IBLevel.find().sort({ order: 1 })
    }
    res.json({ success: true, levels })
  } catch (error) {
    console.error('Error fetching levels:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/ib/admin/levels - Create new IB level
router.post('/admin/levels', async (req, res) => {
  try {
    const { name, order, referralTarget, commissionRate, commissionType, downlineCommission, color, icon } = req.body

    if (!name || order === undefined) {
      return res.status(400).json({ success: false, message: 'Name and order are required' })
    }

    // Check if order already exists
    const existingOrder = await IBLevel.findOne({ order })
    if (existingOrder) {
      return res.status(400).json({ success: false, message: 'A level with this order already exists' })
    }

    const level = await IBLevel.create({
      name,
      order,
      referralTarget: referralTarget || 0,
      commissionRate: commissionRate || 0,
      commissionType: commissionType || 'PER_LOT',
      downlineCommission: downlineCommission || { level1: 0, level2: 0, level3: 0, level4: 0, level5: 0 },
      color: color || '#10B981',
      icon: icon || 'award'
    })

    res.json({ success: true, message: 'Level created successfully', level })
  } catch (error) {
    console.error('Error creating level:', error)
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A level with this name already exists' })
    }
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/levels/:levelId - Update IB level
router.put('/admin/levels/:levelId', async (req, res) => {
  try {
    const { levelId } = req.params
    const { name, order, referralTarget, commissionRate, commissionType, downlineCommission, color, icon, isActive } = req.body

    const level = await IBLevel.findById(levelId)
    if (!level) {
      return res.status(404).json({ success: false, message: 'Level not found' })
    }

    // Check if new order conflicts with existing level
    if (order !== undefined && order !== level.order) {
      const existingOrder = await IBLevel.findOne({ order, _id: { $ne: levelId } })
      if (existingOrder) {
        return res.status(400).json({ success: false, message: 'A level with this order already exists' })
      }
    }

    if (name !== undefined) level.name = name
    if (order !== undefined) level.order = order
    if (referralTarget !== undefined) level.referralTarget = referralTarget
    if (commissionRate !== undefined) level.commissionRate = commissionRate
    if (commissionType !== undefined) level.commissionType = commissionType
    if (downlineCommission !== undefined) level.downlineCommission = downlineCommission
    if (color !== undefined) level.color = color
    if (icon !== undefined) level.icon = icon
    if (isActive !== undefined) level.isActive = isActive

    await level.save()

    res.json({ success: true, message: 'Level updated successfully', level })
  } catch (error) {
    console.error('Error updating level:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// DELETE /api/ib/admin/levels/:levelId - Delete IB level
router.delete('/admin/levels/:levelId', async (req, res) => {
  try {
    const { levelId } = req.params

    // Check if any IBs are using this level
    const ibsUsingLevel = await User.countDocuments({ ibLevelId: levelId })
    if (ibsUsingLevel > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete level. ${ibsUsingLevel} IBs are at this level.` 
      })
    }

    await IBLevel.findByIdAndDelete(levelId)
    res.json({ success: true, message: 'Level deleted successfully' })
  } catch (error) {
    console.error('Error deleting level:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/user-level/:userId - Manually change user's IB level
router.put('/admin/user-level/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { levelId } = req.body

    const user = await User.findById(userId)
    if (!user || !user.isIB) {
      return res.status(404).json({ success: false, message: 'IB not found' })
    }

    const level = await IBLevel.findById(levelId)
    if (!level) {
      return res.status(404).json({ success: false, message: 'Level not found' })
    }

    user.ibLevelId = level._id
    user.ibLevelOrder = level.order
    await user.save()

    res.json({ 
      success: true, 
      message: `User level changed to ${level.name}`,
      user: {
        _id: user._id,
        firstName: user.firstName,
        ibLevelId: user.ibLevelId,
        ibLevelOrder: user.ibLevelOrder
      }
    })
  } catch (error) {
    console.error('Error changing user level:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/toggle-auto-upgrade/:userId - Toggle auto-upgrade for user
router.put('/toggle-auto-upgrade/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { enabled } = req.body

    const user = await User.findById(userId)
    if (!user || !user.isIB) {
      return res.status(404).json({ success: false, message: 'IB not found' })
    }

    user.autoUpgradeEnabled = enabled !== undefined ? enabled : !user.autoUpgradeEnabled
    await user.save()

    res.json({ 
      success: true, 
      message: `Auto-upgrade ${user.autoUpgradeEnabled ? 'enabled' : 'disabled'}`,
      autoUpgradeEnabled: user.autoUpgradeEnabled
    })
  } catch (error) {
    console.error('Error toggling auto-upgrade:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// POST /api/ib/admin/init-levels - Initialize default levels
router.post('/admin/init-levels', async (req, res) => {
  try {
    await IBLevel.initializeDefaultLevels()
    const levels = await IBLevel.getAllLevels()
    res.json({ success: true, message: 'Default levels initialized', levels })
  } catch (error) {
    console.error('Error initializing levels:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// ==================== IB COMMISSION % (per account type × chain level) ====================

// GET /api/ib/admin/commission-config/summary — which account types have configs
router.get('/admin/commission-config/summary', async (req, res) => {
  try {
    const types = await AccountType.find({}).select('name isActive').sort({ name: 1 }).lean()
    const withCounts = await Promise.all(
      types.map(async (t) => {
        const n = await IBCommissionConfig.countDocuments({ accountTypeId: t._id, isActive: true })
        return { ...t, activeLevelCount: n }
      })
    )
    res.json({ success: true, accountTypes: withCounts })
  } catch (error) {
    console.error('Error fetching commission config summary:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/ib/admin/commission-config/:accountTypeId
router.get('/admin/commission-config/:accountTypeId', async (req, res) => {
  try {
    const { accountTypeId } = req.params
    const accountType = await AccountType.findById(accountTypeId).lean()
    if (!accountType) {
      return res.status(404).json({ success: false, message: 'Account type not found' })
    }
    const levels = await IBCommissionConfig.find({ accountTypeId }).sort({ level: 1 }).lean()
    const totalPercent = levels.filter((l) => l.isActive).reduce((s, l) => s + l.commissionPercent, 0)
    res.json({ success: true, accountType, levels, totalPercent })
  } catch (error) {
    console.error('Error fetching commission config:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/commission-config/:accountTypeId
// body: { levels: [{ level: 1, commissionPercent: 30, isActive: true }, ...] }
router.put('/admin/commission-config/:accountTypeId', async (req, res) => {
  try {
    const { accountTypeId } = req.params
    const { levels } = req.body
    if (!Array.isArray(levels) || levels.length === 0) {
      return res.status(400).json({ success: false, message: 'levels array required' })
    }
    const at = await AccountType.findById(accountTypeId)
    if (!at) {
      return res.status(404).json({ success: false, message: 'Account type not found' })
    }
    const activeSum = levels.filter((l) => l.isActive !== false).reduce((s, l) => s + Number(l.commissionPercent || 0), 0)
    if (activeSum > 100) {
      return res.status(400).json({
        success: false,
        message: `Total active commission % is ${activeSum}. Must be ≤ 100 (remainder stays with platform).`
      })
    }
    const seen = new Set()
    for (const row of levels) {
      if (row.level < 1 || row.level > 20) {
        return res.status(400).json({ success: false, message: 'Each level must be between 1 and 20' })
      }
      if (seen.has(row.level)) {
        return res.status(400).json({ success: false, message: `Duplicate level ${row.level}` })
      }
      seen.add(row.level)
      if (Number(row.commissionPercent) < 0) {
        return res.status(400).json({ success: false, message: 'commissionPercent must be ≥ 0' })
      }
    }
    await IBCommissionConfig.replaceForAccountType(accountTypeId, levels)
    const saved = await IBCommissionConfig.find({ accountTypeId }).sort({ level: 1 }).lean()
    const totalPercent = saved.filter((l) => l.isActive).reduce((s, l) => s + l.commissionPercent, 0)
    res.json({
      success: true,
      message: 'IB commission configuration saved. Applies to new closed trades only.',
      levels: saved,
      totalPercent,
      platformApproxPercent: Math.max(0, 100 - totalPercent)
    })
  } catch (error) {
    console.error('Error saving commission config:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// POST /api/ib/admin/commission-config/seed-defaults — 30/22/15/8/5 for each account type missing config
router.post('/admin/commission-config/seed-defaults', async (req, res) => {
  try {
    const types = await AccountType.find({})
    const template = [30, 22, 15, 8, 5]
    let created = 0
    for (const t of types) {
      const n = await IBCommissionConfig.countDocuments({ accountTypeId: t._id })
      if (n > 0) continue
      for (let i = 0; i < template.length; i++) {
        await IBCommissionConfig.create({
          accountTypeId: t._id,
          level: i + 1,
          commissionPercent: template[i],
          isActive: true
        })
        created++
      }
    }
    res.json({
      success: true,
      message: `Seeded default 5-level % for account types that had no config (${created} rows).`
    })
  } catch (error) {
    console.error('Error seeding commission config:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/ib/admin/commission-config/:accountTypeId — remove config (fall back to legacy IB plan)
router.delete('/admin/commission-config/:accountTypeId', async (req, res) => {
  try {
    await IBCommissionConfig.deleteMany({ accountTypeId: req.params.accountTypeId })
    res.json({ success: true, message: 'Config removed. Trades will use legacy IB plan distribution.' })
  } catch (error) {
    console.error('Error deleting commission config:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

// ==================== SETTINGS ROUTES ====================

// GET /api/ib/admin/settings - Get IB settings
router.get('/admin/settings', async (req, res) => {
  try {
    const settings = await IBSettings.getSettings()
    res.json({ success: true, settings })
  } catch (error) {
    console.error('Error fetching IB settings:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/ib/admin/settings - Update IB settings
router.put('/admin/settings', async (req, res) => {
  try {
    const settings = await IBSettings.getSettings()
    const { 
      ibRequirements, 
      commissionSettings, 
      isEnabled, 
      allowNewApplications, 
      autoApprove 
    } = req.body

    if (ibRequirements) {
      settings.ibRequirements = { ...settings.ibRequirements, ...ibRequirements }
    }
    if (commissionSettings) {
      settings.commissionSettings = { ...settings.commissionSettings, ...commissionSettings }
    }
    if (isEnabled !== undefined) settings.isEnabled = isEnabled
    if (allowNewApplications !== undefined) settings.allowNewApplications = allowNewApplications
    if (autoApprove !== undefined) settings.autoApprove = autoApprove

    await settings.save()
    res.json({ success: true, settings })
  } catch (error) {
    console.error('Error updating IB settings:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
