import mongoose from 'mongoose'

const ibCommissionConfigSchema = new mongoose.Schema(
  {
    accountTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AccountType',
      required: true,
      index: true
    },
    level: {
      type: Number,
      required: true,
      min: 1,
      max: 20
    },
    commissionPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

ibCommissionConfigSchema.index({ accountTypeId: 1, level: 1 }, { unique: true })

ibCommissionConfigSchema.statics.getOrderedForAccountType = async function (accountTypeId) {
  if (!accountTypeId) return []
  return this.find({ accountTypeId }).sort({ level: 1 }).lean()
}

ibCommissionConfigSchema.statics.replaceForAccountType = async function (accountTypeId, levels) {
  await this.deleteMany({ accountTypeId })
  if (!levels?.length) return []
  const docs = levels
    .filter((l) => l.level >= 1 && l.commissionPercent > 0)
    .map((l) => ({
      accountTypeId,
      level: l.level,
      commissionPercent: l.commissionPercent,
      isActive: l.isActive !== false
    }))
  if (docs.length === 0) return []
  return this.insertMany(docs)
}

export default mongoose.model('IBCommissionConfig', ibCommissionConfigSchema)
