import mongoose from 'mongoose'

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true
  },
  otp: {
    type: String,
    required: true
  },
  purpose: {
    type: String,
    enum: ['signup', 'password_reset', 'login'],
    default: 'signup'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  // The signup payload held between /api/v1/auth/register/start and
  // .../verify. The mobile app collects the form first and sends only
  // {email, otp} to verify, so the details have to wait here in the meantime.
  // Unused by the web flow, which posts the whole form to /api/auth/signup.
  pendingSignup: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, { timestamps: true })

// Auto-delete expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('OTP', otpSchema)
