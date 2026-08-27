import mongoose from 'mongoose'

const kycSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  documentType: {
    type: String,
    enum: ['passport', 'driving_license', 'national_id', 'aadhaar', 'pan_card', 'voter_id'],
    required: true
  },
  documentNumber: {
    type: String,
    required: true
  },
  frontImage: {
    type: String,  // Base64 or URL
    required: true
  },
  backImage: {
    type: String,  // Base64 or URL (optional for some docs)
  },
  selfieImage: {
    type: String,  // Base64 or URL
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionReason: {
    type: String
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  reviewedAt: {
    type: Date
  },
  submittedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
})

// The admin list sorts by submittedAt, and every KYC document carries three
// base64 images - so an unindexed sort has to hold the entire collection in
// memory, which crosses Mongo's 32MB ceiling and makes it refuse the query
// outright ("Sort exceeded memory limit ... did not opt in to external
// sorting"). The admin's KYC page has been returning a 500 ever since the
// collection grew past that line. Sorting off an index needs no memory at all.
//
// The compound index serves the filtered tabs (pending/approved/rejected) and
// the plain one serves the unfiltered list.
kycSchema.index({ submittedAt: -1 })
kycSchema.index({ status: 1, submittedAt: -1 })

const KYC = mongoose.model('KYC', kycSchema)

export default KYC
