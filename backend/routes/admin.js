import express from 'express'
import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import Transaction from '../models/Transaction.js'
import Trade from '../models/Trade.js'
import CreditRequest from '../models/CreditRequest.js'
import { sendTemplateEmail } from '../services/emailService.js'
import EmailSettings from '../models/EmailSettings.js'

const router = express.Router()

// GET /api/admin/dashboard-stats - Get dashboard statistics
router.get('/dashboard-stats', async (req, res) => {
  try {
    // Get user stats
    const totalUsers = await User.countDocuments()
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const newThisWeek = await User.countDocuments({ createdAt: { $gte: oneWeekAgo } })
    const pendingKYC = await User.countDocuments({ kycStatus: { $in: ['pending', 'Pending', null] } })
    
    // Get transaction stats (using correct capitalized enum values)
    const depositStats = await Transaction.aggregate([
      { $match: { type: 'Deposit', status: { $in: ['Approved', 'Completed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
    const withdrawalStats = await Transaction.aggregate([
      { $match: { type: 'Withdrawal', status: { $in: ['Approved', 'Completed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'Withdrawal', status: 'Pending' })
    
    // Get active trades count
    const activeTrades = await Trade.countDocuments({ status: { $in: ['OPEN', 'PENDING'] } })
    
    res.json({
      success: true,
      stats: {
        totalUsers,
        newThisWeek,
        pendingKYC,
        totalDeposits: depositStats[0]?.total || 0,
        totalWithdrawals: withdrawalStats[0]?.total || 0,
        pendingWithdrawals,
        activeTrades
      }
    })
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    res.status(500).json({ success: false, message: 'Error fetching stats', error: error.message })
  }
})

// GET /api/admin/users - Get all users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 })
    res.json({
      success: true,
      message: 'Users fetched successfully',
      users,
      total: users.length
    })
  } catch (error) {
    console.error('Error fetching users:', error)
    res.status(500).json({ success: false, message: 'Error fetching users', error: error.message })
  }
})

// GET /api/admin/users/:id - Get single user
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    res.json({ user })
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user', error: error.message })
  }
})

// PUT /api/admin/users/:id/password - Change user password
router.put('/users/:id/password', async (req, res) => {
  try {
    const { password } = req.body
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
    }
    
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    
    user.password = password
    await user.save()
    
    res.json({ success: true, message: 'Password updated successfully' })
  } catch (error) {
    console.error('Error updating password:', error)
    res.status(500).json({ success: false, message: 'Error updating password', error: error.message })
  }
})

// POST /api/admin/users/:id/deduct - Deduct funds from user wallet
router.post('/users/:id/deduct', async (req, res) => {
  try {
    const { amount, reason, transactionDate } = req.body
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' })
    }
    
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    
    // Use Wallet model (same as user wallet page)
    const Wallet = (await import('../models/Wallet.js')).default
    let wallet = await Wallet.findOne({ userId: req.params.id })
    if (!wallet) {
      return res.status(400).json({ success: false, message: 'User has no wallet' })
    }
    
    if ((wallet.balance || 0) < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' })
    }
    
    wallet.balance = (wallet.balance || 0) - parseFloat(amount)
    await wallet.save()
    
    // Create transaction record
    const txData = {
      userId: req.params.id,
      walletId: wallet._id,
      type: 'Withdrawal',
      amount: parseFloat(amount),
      paymentMethod: 'System',
      description: reason || 'Admin deduction',
      status: 'Completed',
      processedAt: new Date()
    }
    const transaction = await Transaction.create(txData)
    
    // Override createdAt if custom date provided (use raw MongoDB to bypass Mongoose timestamps)
    if (transactionDate) {
      await Transaction.collection.updateOne(
        { _id: transaction._id },
        { $set: { createdAt: new Date(transactionDate) } }
      )
    }
    
    console.log(`[Admin] Deducted $${amount} from user ${user.email} wallet. New balance: $${wallet.balance}`)
    
    res.json({ 
      success: true,
      message: 'Funds deducted successfully',
      newBalance: wallet.balance
    })
  } catch (error) {
    console.error('Error deducting funds:', error)
    res.status(500).json({ success: false, message: 'Error deducting funds', error: error.message })
  }
})

// POST /api/admin/users/:id/add-fund - Add funds to user wallet (Admin only)
router.post('/users/:id/add-fund', async (req, res) => {
  try {
    const { amount, reason, transactionDate } = req.body
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' })
    }
    
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    
    // Use Wallet model (same as user wallet page)
    const Wallet = (await import('../models/Wallet.js')).default
    let wallet = await Wallet.findOne({ userId: req.params.id })
    if (!wallet) {
      wallet = new Wallet({ userId: req.params.id, balance: 0 })
    }
    
    const previousBalance = wallet.balance || 0
    wallet.balance = previousBalance + parseFloat(amount)
    await wallet.save()
    
    // Create transaction record
    const txData = {
      userId: req.params.id,
      walletId: wallet._id,
      type: 'Deposit',
      amount: parseFloat(amount),
      paymentMethod: 'System',
      description: reason || 'Admin fund addition',
      status: 'Completed',
      processedAt: new Date()
    }
    const transaction = await Transaction.create(txData)
    
    // Override createdAt if custom date provided (use raw MongoDB to bypass Mongoose timestamps)
    if (transactionDate) {
      await Transaction.collection.updateOne(
        { _id: transaction._id },
        { $set: { createdAt: new Date(transactionDate) } }
      )
    }
    
    console.log(`[Admin] Added $${amount} to user ${user.email} wallet. Balance: $${previousBalance} -> $${wallet.balance}`)
    
    res.json({ 
      success: true,
      message: 'Funds added successfully',
      previousBalance,
      newBalance: wallet.balance,
      amountAdded: parseFloat(amount)
    })
  } catch (error) {
    console.error('Error adding funds:', error)
    res.status(500).json({ success: false, message: 'Error adding funds', error: error.message })
  }
})

// POST /api/admin/trading-account/:id/add-fund - Add funds to trading account (Admin only)
router.post('/trading-account/:id/add-fund', async (req, res) => {
  try {
    const { amount, reason, transactionDate } = req.body
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' })
    }
    
    const TradingAccount = (await import('../models/TradingAccount.js')).default
    const account = await TradingAccount.findById(req.params.id)
    if (!account) {
      return res.status(404).json({ success: false, message: 'Trading account not found' })
    }
    
    account.balance = (account.balance || 0) + parseFloat(amount)
    await account.save()
    
    // Create transaction record
    const txData = {
      userId: account.userId,
      tradingAccountId: account._id,
      tradingAccountName: account.accountId || account.name || '',
      type: 'Deposit',
      amount: parseFloat(amount),
      paymentMethod: 'System',
      description: reason || 'Admin fund addition to trading account',
      status: 'Completed',
      processedAt: new Date()
    }
    const transaction = await Transaction.create(txData)
    
    // Override createdAt if custom date provided (use raw MongoDB to bypass Mongoose timestamps)
    if (transactionDate) {
      await Transaction.collection.updateOne(
        { _id: transaction._id },
        { $set: { createdAt: new Date(transactionDate) } }
      )
    }
    
    res.json({ 
      success: true,
      message: 'Funds added to trading account successfully',
      newBalance: account.balance
    })
  } catch (error) {
    console.error('Error adding funds to trading account:', error)
    res.status(500).json({ success: false, message: 'Error adding funds', error: error.message })
  }
})

// POST /api/admin/trading-account/:id/deduct - Deduct funds from trading account (Admin only)
router.post('/trading-account/:id/deduct', async (req, res) => {
  try {
    const { amount, reason, transactionDate } = req.body
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' })
    }
    
    const TradingAccount = (await import('../models/TradingAccount.js')).default
    const account = await TradingAccount.findById(req.params.id)
    if (!account) {
      return res.status(404).json({ success: false, message: 'Trading account not found' })
    }
    
    if ((account.balance || 0) < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance in trading account' })
    }
    
    account.balance = (account.balance || 0) - parseFloat(amount)
    await account.save()
    
    // Create transaction record
    const txData = {
      userId: account.userId,
      tradingAccountId: account._id,
      tradingAccountName: account.accountId || account.name || '',
      type: 'Withdrawal',
      amount: parseFloat(amount),
      paymentMethod: 'System',
      description: reason || 'Admin deduction from trading account',
      status: 'Completed',
      processedAt: new Date()
    }
    const transaction = await Transaction.create(txData)
    
    // Override createdAt if custom date provided (use raw MongoDB to bypass Mongoose timestamps)
    if (transactionDate) {
      await Transaction.collection.updateOne(
        { _id: transaction._id },
        { $set: { createdAt: new Date(transactionDate) } }
      )
    }
    
    res.json({ 
      success: true,
      message: 'Funds deducted from trading account successfully',
      newBalance: account.balance
    })
  } catch (error) {
    console.error('Error deducting funds from trading account:', error)
    res.status(500).json({ success: false, message: 'Error deducting funds', error: error.message })
  }
})

// PUT /api/admin/users/:id/block - Block/Unblock user
router.put('/users/:id/block', async (req, res) => {
  try {
    const { blocked, reason } = req.body
    
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    
    user.isBlocked = blocked
    user.blockReason = blocked ? (reason || 'Blocked by admin') : ''
    await user.save()
    
    res.json({ 
      success: true,
      message: blocked ? 'User blocked successfully' : 'User unblocked successfully',
      isBlocked: user.isBlocked
    })
  } catch (error) {
    console.error('Error updating user block status:', error)
    res.status(500).json({ success: false, message: 'Error updating user status', error: error.message })
  }
})

// PUT /api/admin/users/:id/ban - Ban/Unban user
router.put('/users/:id/ban', async (req, res) => {
  try {
    const { banned, reason } = req.body
    
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    
    user.isBanned = banned
    user.banReason = banned ? (reason || 'Banned by admin') : ''
    if (banned) {
      user.isBlocked = true
    }
    await user.save()

    // Send email notification
    try {
      if (user.email) {
        const settings = await EmailSettings.findOne()
        const templateSlug = banned ? 'account_banned' : 'account_unbanned'
        await sendTemplateEmail(templateSlug, user.email, {
          firstName: user.firstName || user.email.split('@')[0],
          email: user.email,
          reason: reason || 'Policy violation',
          date: new Date().toLocaleString(),
          platformName: settings?.platformName || 'vxness',
          loginUrl: settings?.loginUrl || 'https://vxness.com/login',
          supportEmail: settings?.supportEmail || 'support@vxness.com',
          year: new Date().getFullYear().toString()
        })
      }
    } catch (emailError) {
      console.error('Error sending ban/unban email:', emailError)
    }
    
    res.json({ 
      success: true,
      message: banned ? 'User banned successfully' : 'User unbanned successfully',
      isBanned: user.isBanned
    })
  } catch (error) {
    console.error('Error updating user ban status:', error)
    res.status(500).json({ success: false, message: 'Error updating user status', error: error.message })
  }
})

// DELETE /api/admin/users/:id - Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    res.json({ message: 'User deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user', error: error.message })
  }
})

// ==================== CREDIT/BONUS SYSTEM ====================

// POST /api/admin/trading-account/:id/add-credit - Add credit/bonus to trading account
router.post('/trading-account/:id/add-credit', async (req, res) => {
  try {
    const { amount, reason, adminId, transactionDate } = req.body
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' })
    }
    
    const TradingAccount = (await import('../models/TradingAccount.js')).default
    const account = await TradingAccount.findById(req.params.id)
    if (!account) {
      return res.status(404).json({ success: false, message: 'Trading account not found' })
    }
    
    const previousCredit = account.credit || 0
    account.credit = previousCredit + parseFloat(amount)
    await account.save()
    
    // Create transaction record for credit
    const txData = {
      userId: account.userId,
      tradingAccountId: account._id,
      tradingAccountName: account.accountId || account.name || '',
      type: 'Credit',
      amount: parseFloat(amount),
      paymentMethod: 'System',
      description: reason || 'Admin credit/bonus',
      status: 'Completed',
      processedAt: new Date()
    }
    const transaction = await Transaction.create(txData)
    
    // Override createdAt if custom date provided (use raw MongoDB to bypass Mongoose timestamps)
    if (transactionDate) {
      await Transaction.collection.updateOne(
        { _id: transaction._id },
        { $set: { createdAt: new Date(transactionDate) } }
      )
    }
    
    // Log the credit addition (optional - don't fail if logging fails)
    if (adminId) {
      try {
        const AdminLog = (await import('../models/AdminLog.js')).default
        await AdminLog.create({
          adminId,
          action: 'ADD_CREDIT',
          targetType: 'TRADING_ACCOUNT',
          targetId: account._id,
          previousValue: { credit: previousCredit },
          newValue: { credit: account.credit },
          reason: reason || 'Credit/Bonus added'
        })
      } catch (logError) {
        console.error('Error logging credit addition:', logError)
      }
    }
    
    res.json({ 
      success: true,
      message: 'Credit added successfully',
      previousCredit,
      newCredit: account.credit,
      balance: account.balance
    })
  } catch (error) {
    console.error('Error adding credit:', error)
    res.status(500).json({ success: false, message: 'Error adding credit', error: error.message })
  }
})

// POST /api/admin/trading-account/:id/remove-credit - Remove credit from trading account
router.post('/trading-account/:id/remove-credit', async (req, res) => {
  try {
    const { amount, reason, adminId } = req.body
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' })
    }
    
    const TradingAccount = (await import('../models/TradingAccount.js')).default
    const account = await TradingAccount.findById(req.params.id)
    if (!account) {
      return res.status(404).json({ message: 'Trading account not found' })
    }
    
    const previousCredit = account.credit || 0
    if (amount > previousCredit) {
      return res.status(400).json({ message: 'Cannot remove more credit than available' })
    }
    
    account.credit = previousCredit - parseFloat(amount)
    await account.save()
    
    // Log the credit removal (optional)
    if (adminId) {
      try {
        const AdminLog = (await import('../models/AdminLog.js')).default
        await AdminLog.create({
          adminId,
          action: 'REMOVE_CREDIT',
          targetType: 'TRADING_ACCOUNT',
          targetId: account._id,
          previousValue: { credit: previousCredit },
          newValue: { credit: account.credit },
          reason: reason || 'Credit removed'
        })
      } catch (logError) {
        console.error('Error logging credit removal:', logError)
      }
    }
    
    res.json({ 
      message: 'Credit removed successfully',
      previousCredit,
      newCredit: account.credit
    })
  } catch (error) {
    console.error('Error removing credit:', error)
    res.status(500).json({ message: 'Error removing credit', error: error.message })
  }
})

// GET /api/admin/trading-account/:id/summary - Get account summary with equity calculation
router.get('/trading-account/:id/summary', async (req, res) => {
  try {
    const TradingAccount = (await import('../models/TradingAccount.js')).default
    const Trade = (await import('../models/Trade.js')).default
    
    const account = await TradingAccount.findById(req.params.id).populate('userId', 'firstName lastName email')
    if (!account) {
      return res.status(404).json({ message: 'Trading account not found' })
    }
    
    // Get open trades for margin calculation
    const openTrades = await Trade.find({ tradingAccountId: account._id, status: 'OPEN' })
    
    const usedMargin = openTrades.reduce((sum, t) => sum + (t.marginUsed || 0), 0)
    const floatingPnl = openTrades.reduce((sum, t) => sum + (t.floatingPnl || 0), 0)
    
    // Equity = Balance + Credit + Floating PnL
    const equity = account.balance + (account.credit || 0) + floatingPnl
    const freeMargin = equity - usedMargin
    const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0
    
    res.json({
      account: {
        _id: account._id,
        accountId: account.accountId,
        userId: account.userId,
        balance: account.balance,
        credit: account.credit || 0,
        equity,
        usedMargin,
        freeMargin,
        marginLevel: marginLevel.toFixed(2),
        floatingPnl,
        leverage: account.leverage,
        status: account.status,
        openTradesCount: openTrades.length
      }
    })
  } catch (error) {
    console.error('Error fetching account summary:', error)
    res.status(500).json({ message: 'Error fetching account summary', error: error.message })
  }
})

// POST /api/admin/login-as-user/:userId - Generate token to login as user
router.post('/login-as-user/:userId', async (req, res) => {
  try {
    const { adminId } = req.body
    
    const user = await User.findById(req.params.userId).select('-password')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    
    // Log the admin login as user action (optional)
    if (adminId) {
      try {
        const AdminLog = (await import('../models/AdminLog.js')).default
        await AdminLog.create({
          adminId,
          action: 'LOGIN_AS_USER',
          targetType: 'USER',
          targetId: user._id,
          reason: `Admin logged in as user: ${user.email}`
        })
      } catch (logError) {
        console.error('Error logging login as user:', logError)
      }
    }
    
    // Generate a simple token (in production, use JWT)
    const jwt = (await import('jsonwebtoken')).default
    const token = jwt.sign(
      { userId: user._id, email: user.email, isAdminSession: true },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '2h' }
    )
    
    res.json({
      message: 'Login as user successful',
      token,
      user
    })
  } catch (error) {
    console.error('Error logging in as user:', error)
    res.status(500).json({ message: 'Error logging in as user', error: error.message })
  }
})

// ==================== PASSWORD RESET REQUESTS ====================

// GET /api/admin/password-reset-requests - Get all password reset requests
router.get('/password-reset-requests', async (req, res) => {
  try {
    const PasswordResetRequest = (await import('../models/PasswordResetRequest.js')).default
    const { status } = req.query
    
    const filter = status ? { status } : {}
    const requests = await PasswordResetRequest.find(filter)
      .populate('userId', 'firstName lastName email phone')
      .sort({ createdAt: -1 })
    
    // Get stats
    const pendingCount = await PasswordResetRequest.countDocuments({ status: 'Pending' })
    const completedCount = await PasswordResetRequest.countDocuments({ status: 'Completed' })
    const rejectedCount = await PasswordResetRequest.countDocuments({ status: 'Rejected' })
    
    res.json({ 
      success: true, 
      requests,
      stats: { pending: pendingCount, completed: completedCount, rejected: rejectedCount }
    })
  } catch (error) {
    console.error('Error fetching password reset requests:', error)
    res.status(500).json({ success: false, message: 'Error fetching requests', error: error.message })
  }
})

// PUT /api/admin/password-reset-requests/:id/process - Process password reset request
router.put('/password-reset-requests/:id/process', async (req, res) => {
  try {
    const { action, newPassword, adminRemarks } = req.body
    const PasswordResetRequest = (await import('../models/PasswordResetRequest.js')).default
    
    const request = await PasswordResetRequest.findById(req.params.id).populate('userId')
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' })
    }
    
    if (request.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Request already processed' })
    }
    
    if (action === 'approve') {
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
      }
      
      // Update user password
      const user = await User.findById(request.userId._id)
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' })
      }
      
      // Update email if requested
      if (request.newEmail) {
        user.email = request.newEmail
      }
      
      user.password = newPassword
      await user.save()
      
      request.status = 'Completed'
      request.processedAt = new Date()
      request.adminRemarks = adminRemarks || 'Password reset and sent to user email'
      await request.save()
      
      console.log(`[Password Reset] Completed for user: ${user.email}`)
      
      res.json({ 
        success: true, 
        message: `Password reset for ${user.email}. New password: ${newPassword}`,
        email: request.newEmail || request.email
      })
    } else if (action === 'reject') {
      request.status = 'Rejected'
      request.processedAt = new Date()
      request.adminRemarks = adminRemarks || 'Request rejected'
      await request.save()
      
      res.json({ success: true, message: 'Request rejected' })
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action' })
    }
  } catch (error) {
    console.error('Error processing password reset:', error)
    res.status(500).json({ success: false, message: 'Error processing request', error: error.message })
  }
})

// POST /api/admin/create-user - Admin creates a user with optional custom registration date
router.post('/create-user', async (req, res) => {
  try {
    const { firstName, email, phone, countryCode, password, createdAt } = req.body

    if (!firstName || !email || !password) {
      return res.status(400).json({ success: false, message: 'First name, email, and password are required' })
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' })
    }

    // Build user data
    const userData = {
      firstName,
      email,
      phone: phone || '',
      countryCode: countryCode || '+1',
      password
    }

    // Set custom registration date if provided
    if (createdAt) {
      userData.createdAt = new Date(createdAt)
    }

    const user = await User.create(userData)

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    console.error('Error creating user:', error)
    res.status(500).json({ success: false, message: 'Error creating user', error: error.message })
  }
})

// ==================== CREDIT DEPOSIT REQUESTS (ADMIN) ====================

// GET /api/admin/credit-requests - Get all credit requests
router.get('/credit-requests', async (req, res) => {
  try {
    const requests = await CreditRequest.find()
      .populate('userId', 'firstName email phone')
      .populate('tradingAccountId', 'accountId balance credit')
      .sort({ createdAt: -1 })
    
    res.json({ success: true, requests })
  } catch (error) {
    console.error('Error fetching credit requests:', error)
    res.status(500).json({ success: false, message: 'Error fetching credit requests', error: error.message })
  }
})

// PUT /api/admin/credit-requests/:id/approve - Approve a credit request
router.put('/credit-requests/:id/approve', async (req, res) => {
  try {
    const { adminId } = req.body
    const creditRequest = await CreditRequest.findById(req.params.id)
    if (!creditRequest) {
      return res.status(404).json({ success: false, message: 'Credit request not found' })
    }
    if (creditRequest.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Request has already been processed' })
    }

    const TradingAccount = (await import('../models/TradingAccount.js')).default
    const account = await TradingAccount.findById(creditRequest.tradingAccountId)
    if (!account) {
      return res.status(404).json({ success: false, message: 'Trading account not found' })
    }

    // Add credit to the trading account
    const previousCredit = account.credit || 0
    account.credit = previousCredit + creditRequest.amount
    await account.save()

    // Create transaction record
    const txData = {
      userId: creditRequest.userId,
      tradingAccountId: account._id,
      tradingAccountName: account.accountId || '',
      type: 'Credit',
      amount: creditRequest.amount,
      paymentMethod: 'System',
      description: `Credit request approved: ${creditRequest.reason || 'User credit deposit request'}`,
      status: 'Completed',
      processedAt: new Date()
    }
    await Transaction.create(txData)

    // Update request status
    creditRequest.status = 'Approved'
    creditRequest.processedBy = adminId || null
    creditRequest.processedAt = new Date()
    await creditRequest.save()

    res.json({
      success: true,
      message: 'Credit request approved and credit added to account',
      previousCredit,
      newCredit: account.credit
    })
  } catch (error) {
    console.error('Error approving credit request:', error)
    res.status(500).json({ success: false, message: 'Error approving credit request', error: error.message })
  }
})

// PUT /api/admin/credit-requests/:id/reject - Reject a credit request
router.put('/credit-requests/:id/reject', async (req, res) => {
  try {
    const { adminId, adminNote } = req.body
    const creditRequest = await CreditRequest.findById(req.params.id)
    if (!creditRequest) {
      return res.status(404).json({ success: false, message: 'Credit request not found' })
    }
    if (creditRequest.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Request has already been processed' })
    }

    creditRequest.status = 'Rejected'
    creditRequest.adminNote = adminNote || ''
    creditRequest.processedBy = adminId || null
    creditRequest.processedAt = new Date()
    await creditRequest.save()

    res.json({
      success: true,
      message: 'Credit request rejected'
    })
  } catch (error) {
    console.error('Error rejecting credit request:', error)
    res.status(500).json({ success: false, message: 'Error rejecting credit request', error: error.message })
  }
})

// ==================== CREDIT IN/OUT (ADMIN DIRECT) ====================

// POST /api/admin/credit/add - Admin directly add credit to account
router.post('/credit/add', async (req, res) => {
  try {
    const { tradingAccountId, amount, reason, adminId, creditRequestId } = req.body

    if (!tradingAccountId || !amount) {
      return res.status(400).json({ success: false, message: 'Account ID and amount are required' })
    }

    const TradingAccount = (await import('../models/TradingAccount.js')).default
    const CreditRequest = (await import('../models/CreditRequest.js')).default
    const account = await TradingAccount.findById(tradingAccountId)
    if (!account) {
      return res.status(404).json({ success: false, message: 'Trading account not found' })
    }

    const creditAmount = parseFloat(amount)
    if (isNaN(creditAmount) || creditAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' })
    }

    // Add credit to account
    const previousCredit = account.credit || 0
    account.credit = previousCredit + creditAmount
    await account.save()

    // Create transaction record
    await Transaction.create({
      userId: account.userId,
      tradingAccountId: account._id,
      tradingAccountName: account.accountId || '',
      type: 'Credit',
      amount: creditAmount,
      paymentMethod: 'System',
      description: reason || 'Admin Credit In',
      status: 'Completed',
      processedAt: new Date()
    })

    // Update CreditRequest with additional credit if creditRequestId provided
    if (creditRequestId) {
      await CreditRequest.findByIdAndUpdate(creditRequestId, {
        $inc: { additionalCreditIn: creditAmount }
      })
    }

    res.json({
      success: true,
      message: `Credit of $${creditAmount.toFixed(2)} added successfully`,
      newCredit: account.credit
    })
  } catch (error) {
    console.error('Error adding credit:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/admin/credit/remove - Admin directly remove credit from account
router.post('/credit/remove', async (req, res) => {
  try {
    const { tradingAccountId, amount, reason, adminId, creditRequestId } = req.body

    if (!tradingAccountId || !amount) {
      return res.status(400).json({ success: false, message: 'Account ID and amount are required' })
    }

    const TradingAccount = (await import('../models/TradingAccount.js')).default
    const CreditRequest = (await import('../models/CreditRequest.js')).default
    const account = await TradingAccount.findById(tradingAccountId)
    if (!account) {
      return res.status(404).json({ success: false, message: 'Trading account not found' })
    }

    const creditAmount = parseFloat(amount)
    if (isNaN(creditAmount) || creditAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' })
    }

    const currentCredit = account.credit || 0
    if (creditAmount > currentCredit) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot remove $${creditAmount.toFixed(2)}. Account only has $${currentCredit.toFixed(2)} credit.` 
      })
    }

    // Remove credit from account
    account.credit = currentCredit - creditAmount
    await account.save()

    // Create transaction record
    await Transaction.create({
      userId: account.userId,
      tradingAccountId: account._id,
      tradingAccountName: account.accountId || '',
      type: 'Credit_Out',
      amount: creditAmount,
      paymentMethod: 'System',
      description: reason || 'Admin Credit Out',
      status: 'Completed',
      processedAt: new Date()
    })

    // Update CreditRequest with additional credit out if creditRequestId provided
    if (creditRequestId) {
      await CreditRequest.findByIdAndUpdate(creditRequestId, {
        $inc: { additionalCreditOut: creditAmount }
      })
    }

    res.json({
      success: true,
      message: `Credit of $${creditAmount.toFixed(2)} removed successfully`,
      newCredit: account.credit
    })
  } catch (error) {
    console.error('Error removing credit:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
