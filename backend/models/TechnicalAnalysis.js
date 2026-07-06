import mongoose from 'mongoose'

const technicalAnalysisSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  image: {
    type: String,
    required: true
  },
  symbol: {
    type: String,
    default: ''
  },
  analysisType: {
    type: String,
    enum: ['bullish', 'bearish', 'neutral'],
    default: 'neutral'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  viewedBy: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    viewedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
})

export default mongoose.model('TechnicalAnalysis', technicalAnalysisSchema)
