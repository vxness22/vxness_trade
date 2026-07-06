import mongoose from 'mongoose'

const tradingAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  accountTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AccountType',
    required: true
  },
  accountId: {
    type: String,
    unique: true,
    required: true
  },
  balance: {
    type: Number,
    default: 0
  },
  credit: {
    type: Number,
    default: 0
  },
  leverage: {
    type: String,
    required: true
  },
  exposureLimit: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Active', 'Suspended', 'Closed', 'Frozen', 'Archived'],
    default: 'Active'
  },
  frozenReason: {
    type: String,
    default: ''
  },
  frozenAt: {
    type: Date,
    default: null
  },
  frozenBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  isDemo: {
    type: Boolean,
    default: false
  },
  masterPassword: {
    type: String,
    default: null
  },
  investorPassword: {
    type: String,
    default: null
  }
}, { timestamps: true })

// Generate random password (8 characters: letters + numbers)
tradingAccountSchema.statics.generatePassword = function() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let password = ''
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

// Generate unique account ID (numbers only, 8 digits)
tradingAccountSchema.statics.generateAccountId = async function() {
  const random = Math.floor(10000000 + Math.random() * 90000000)
  const accountId = `${random}`
  const exists = await this.findOne({ accountId })
  if (exists) return this.generateAccountId()
  return accountId
}

export default mongoose.model('TradingAccount', tradingAccountSchema)
