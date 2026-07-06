import mongoose from 'mongoose'

const marginAlertSchema = new mongoose.Schema({
  // The trading account this alert is for
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TradingAccount',
    required: true
  },
  // The user who owns the account
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Margin percentage threshold (e.g., 50 means alert when margin level reaches 50%)
  marginThreshold: {
    type: Number,
    required: true,
    min: 1,
    max: 100
  },
  // Whether this alert is active
  isActive: {
    type: Boolean,
    default: true
  },
  // Admin who set this alert
  setBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  // Notes for admin (e.g., "Call user immediately")
  notes: {
    type: String,
    default: ''
  },
  // Last time the alert was triggered
  lastTriggeredAt: {
    type: Date,
    default: null
  },
  // Number of times this alert has been triggered
  triggerCount: {
    type: Number,
    default: 0
  },
  // Whether admin has been notified for current trigger
  adminNotified: {
    type: Boolean,
    default: false
  },
  // Contact preference when alert triggers
  contactPreference: {
    type: String,
    enum: ['call', 'email', 'both', 'notification_only'],
    default: 'notification_only'
  }
}, { timestamps: true })

// Index for quick lookups
marginAlertSchema.index({ accountId: 1, isActive: 1 })
marginAlertSchema.index({ userId: 1 })

export default mongoose.model('MarginAlert', marginAlertSchema)
