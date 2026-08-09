import mongoose from 'mongoose'
import crypto from 'crypto'

// Rotating refresh token for the desktop terminal's `pt_refresh` cookie.
//
// The terminal holds a ~45-minute access token and renews it on a timer. The
// refresh credential is SINGLE USE by design: every refresh returns a
// replacement and invalidates the one presented, so a stolen cookie is only
// usable until the legitimate client next renews (at which point the theft
// surfaces as a forced sign-out rather than a silent parallel session).
const refreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // SHA-256 of the token. A leak of this collection must not hand out sessions.
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  usedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true })

// Mongo drops the document once expiresAt passes — no cleanup cron needed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

export const REFRESH_TTL_DAYS = 7

refreshTokenSchema.statics.issue = async function (userId) {
  const token = crypto.randomBytes(32).toString('hex')
  await this.create({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
  })
  return token
}

// Consumes a token and issues its replacement. Returns null when the presented
// token is unknown, already used, or expired.
refreshTokenSchema.statics.rotate = async function (token) {
  if (!token) return null
  const doc = await this.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  )
  if (!doc) return null
  const next = await this.issue(doc.userId)
  return { userId: doc.userId, token: next }
}

export default mongoose.model('TerminalRefreshToken', refreshTokenSchema)
