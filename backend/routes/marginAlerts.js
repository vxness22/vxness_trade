import express from 'express'
import MarginAlert from '../models/MarginAlert.js'
import TradingAccount from '../models/TradingAccount.js'
import User from '../models/User.js'
import Trade from '../models/Trade.js'

const router = express.Router()

// Get all margin alerts (admin)
router.get('/', async (req, res) => {
  try {
    const alerts = await MarginAlert.find()
      .populate('accountId', 'accountId balance credit leverage')
      .populate('userId', 'firstName email phone countryCode')
      .populate('setBy', 'name email')
      .sort({ createdAt: -1 })
    
    res.json({ success: true, alerts })
  } catch (error) {
    console.error('Error fetching margin alerts:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch margin alerts' })
  }
})

// Get margin alerts for a specific user
router.get('/user/:userId', async (req, res) => {
  try {
    const alerts = await MarginAlert.find({ userId: req.params.userId })
      .populate('accountId', 'accountId balance credit leverage')
      .sort({ createdAt: -1 })
    
    res.json({ success: true, alerts })
  } catch (error) {
    console.error('Error fetching user margin alerts:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch margin alerts' })
  }
})

// Get margin alerts for a specific account
router.get('/account/:accountId', async (req, res) => {
  try {
    const alerts = await MarginAlert.find({ accountId: req.params.accountId })
      .populate('userId', 'firstName email phone')
      .sort({ createdAt: -1 })
    
    res.json({ success: true, alerts })
  } catch (error) {
    console.error('Error fetching account margin alerts:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch margin alerts' })
  }
})

// Create a new margin alert
router.post('/', async (req, res) => {
  try {
    const { accountId, marginThreshold, notes, contactPreference, adminId } = req.body

    // Validate account exists
    const account = await TradingAccount.findById(accountId)
    if (!account) {
      return res.status(404).json({ success: false, message: 'Trading account not found' })
    }

    // Check if alert already exists for this account
    const existingAlert = await MarginAlert.findOne({ accountId, isActive: true })
    if (existingAlert) {
      return res.status(400).json({ 
        success: false, 
        message: 'An active margin alert already exists for this account. Please update or deactivate it first.' 
      })
    }

    const alert = new MarginAlert({
      accountId,
      userId: account.userId,
      marginThreshold,
      notes: notes || '',
      contactPreference: contactPreference || 'notification_only',
      setBy: adminId
    })

    await alert.save()

    const populatedAlert = await MarginAlert.findById(alert._id)
      .populate('accountId', 'accountId balance credit leverage')
      .populate('userId', 'firstName email phone countryCode')

    res.json({ success: true, alert: populatedAlert, message: 'Margin alert created successfully' })
  } catch (error) {
    console.error('Error creating margin alert:', error)
    res.status(500).json({ success: false, message: 'Failed to create margin alert' })
  }
})

// Update a margin alert
router.put('/:alertId', async (req, res) => {
  try {
    const { marginThreshold, notes, contactPreference, isActive } = req.body

    const alert = await MarginAlert.findByIdAndUpdate(
      req.params.alertId,
      {
        ...(marginThreshold !== undefined && { marginThreshold }),
        ...(notes !== undefined && { notes }),
        ...(contactPreference !== undefined && { contactPreference }),
        ...(isActive !== undefined && { isActive })
      },
      { new: true }
    )
      .populate('accountId', 'accountId balance credit leverage')
      .populate('userId', 'firstName email phone countryCode')

    if (!alert) {
      return res.status(404).json({ success: false, message: 'Margin alert not found' })
    }

    res.json({ success: true, alert, message: 'Margin alert updated successfully' })
  } catch (error) {
    console.error('Error updating margin alert:', error)
    res.status(500).json({ success: false, message: 'Failed to update margin alert' })
  }
})

// Delete a margin alert
router.delete('/:alertId', async (req, res) => {
  try {
    const alert = await MarginAlert.findByIdAndDelete(req.params.alertId)
    
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Margin alert not found' })
    }

    res.json({ success: true, message: 'Margin alert deleted successfully' })
  } catch (error) {
    console.error('Error deleting margin alert:', error)
    res.status(500).json({ success: false, message: 'Failed to delete margin alert' })
  }
})

// Check margin levels and get triggered alerts
router.get('/check-margins', async (req, res) => {
  try {
    const activeAlerts = await MarginAlert.find({ isActive: true })
      .populate('accountId', 'accountId balance credit leverage')
      .populate('userId', 'firstName email phone countryCode')

    const triggeredAlerts = []

    for (const alert of activeAlerts) {
      if (!alert.accountId) continue

      // Get open trades for this account
      const openTrades = await Trade.find({ 
        accountId: alert.accountId._id, 
        status: 'OPEN' 
      })

      // Calculate margin usage
      const account = alert.accountId
      const equity = account.balance + account.credit
      
      // Calculate total margin used by open trades
      let totalMarginUsed = 0
      for (const trade of openTrades) {
        // Simplified margin calculation - adjust based on your actual formula
        const leverage = parseInt(account.leverage.replace('1:', '')) || 100
        const marginRequired = (trade.quantity * trade.openPrice) / leverage
        totalMarginUsed += marginRequired
      }

      // Calculate margin level percentage
      // Margin Level = (Equity / Used Margin) * 100
      const marginLevel = totalMarginUsed > 0 ? (equity / totalMarginUsed) * 100 : 100

      // Check if margin level is at or below threshold
      if (marginLevel <= alert.marginThreshold) {
        triggeredAlerts.push({
          alert,
          currentMarginLevel: marginLevel.toFixed(2),
          equity,
          usedMargin: totalMarginUsed,
          openTradesCount: openTrades.length
        })

        // Update alert trigger info
        await MarginAlert.findByIdAndUpdate(alert._id, {
          lastTriggeredAt: new Date(),
          $inc: { triggerCount: 1 },
          adminNotified: false
        })
      }
    }

    res.json({ 
      success: true, 
      triggeredAlerts,
      totalChecked: activeAlerts.length,
      totalTriggered: triggeredAlerts.length
    })
  } catch (error) {
    console.error('Error checking margins:', error)
    res.status(500).json({ success: false, message: 'Failed to check margins' })
  }
})

// Mark alert as notified (admin acknowledged)
router.post('/:alertId/acknowledge', async (req, res) => {
  try {
    const alert = await MarginAlert.findByIdAndUpdate(
      req.params.alertId,
      { adminNotified: true },
      { new: true }
    )

    if (!alert) {
      return res.status(404).json({ success: false, message: 'Margin alert not found' })
    }

    res.json({ success: true, message: 'Alert acknowledged' })
  } catch (error) {
    console.error('Error acknowledging alert:', error)
    res.status(500).json({ success: false, message: 'Failed to acknowledge alert' })
  }
})

// Get triggered alerts that need admin attention
router.get('/triggered', async (req, res) => {
  try {
    const alerts = await MarginAlert.find({ 
      isActive: true,
      lastTriggeredAt: { $ne: null },
      adminNotified: false
    })
      .populate('accountId', 'accountId balance credit leverage')
      .populate('userId', 'firstName email phone countryCode')
      .sort({ lastTriggeredAt: -1 })

    res.json({ success: true, alerts })
  } catch (error) {
    console.error('Error fetching triggered alerts:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch triggered alerts' })
  }
})

export default router
