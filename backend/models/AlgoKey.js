import mongoose from 'mongoose'
import crypto from 'crypto'

// API key/secret pair minted for the desktop terminal (and any other algo
// client). The /api/algo/* endpoints authenticate with these instead of a JWT,
// because market data and /trade have to keep working for ~weeks while a JWT
// access token lives ~45 minutes.
//
// The secret is stored as a SHA-256 digest, not bcrypt: it is a 48-char
// cryptographically random string, so there is no dictionary to attack and the
// digest gets verified on EVERY streamed request — bcrypt's work factor would
// be paid thousands of times a session for no security gain.
const algoKeySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tradingAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TradingAccount',
    required: true,
    index: true
  },
  apiKey: {
    // `unique` already builds the index — adding `index: true` as well is what
    // makes Mongoose warn about a duplicate index definition.
    type: String,
    required: true,
    unique: true
  },
  secretHash: {
    type: String,
    required: true
  },
  label: {
    type: String,
    default: 'Terminal'
  },
  revoked: {
    type: Boolean,
    default: false
  },
  lastUsedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true })

export function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex')
}

// Returns the plaintext pair ONCE — only the digest is persisted.
algoKeySchema.statics.mint = async function (userId, tradingAccountId, label = 'Terminal') {
  const apiKey = 'vx_' + crypto.randomBytes(18).toString('hex')      // 39 chars
  const apiSecret = crypto.randomBytes(24).toString('hex')           // 48 chars

  await this.create({
    userId,
    tradingAccountId,
    apiKey,
    secretHash: hashSecret(apiSecret),
    label
  })

  // Keep the collection bounded: a user who reinstalls repeatedly would
  // otherwise accumulate a key per sign-in forever. Old pairs stay valid so a
  // second machine keeps working; only the tail beyond 10 is retired.
  const stale = await this.find({ userId, tradingAccountId, revoked: false })
    .sort({ createdAt: -1 })
    .skip(10)
    .select('_id')
  if (stale.length) {
    await this.updateMany({ _id: { $in: stale.map(s => s._id) } }, { $set: { revoked: true } })
  }

  return { apiKey, apiSecret }
}

export default mongoose.model('AlgoKey', algoKeySchema)
