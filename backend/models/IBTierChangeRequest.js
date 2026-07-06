import mongoose from 'mongoose'

const ibTierChangeRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    requestType: {
      type: String,
      enum: ['APPLICATION', 'LEVEL_CHANGE'],
      required: true
    },
    requestedLevelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IBLevel',
      required: true
    },
    previousLevelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IBLevel',
      default: null
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true
    },
    rejectionReason: {
      type: String,
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

// At most one pending tier-change request per user
ibTierChangeRequestSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'PENDING', requestType: 'LEVEL_CHANGE' }
  }
)

export default mongoose.model('IBTierChangeRequest', ibTierChangeRequestSchema)
