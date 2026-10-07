import mongoose from 'mongoose'
import crypto from 'crypto'

// A trade a trader chose to share publicly, addressed by a short code
// (vxness.in/s/<code>). One per position: sharing the same trade again — say
// after switching the card from P&L to ROI — updates this record and keeps the
// link the trader may already have posted.
//
// Only what the trader chose to show is ever served from it: the figures of
// that one trade and their own caption. Never their name, email or account.
const sharedTradeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  tradeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trade', required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  description: { type: String, default: '', maxlength: 500, trim: true },
  linkDescription: { type: String, default: '', maxlength: 500, trim: true },
  displayMode: { type: String, enum: ['pnl', 'roi', 'ticks'], default: 'pnl' },
}, { timestamps: true })

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// 8 characters from a 56-symbol alphabet without look-alikes (0/O, 1/l/I):
// about 10^14 codes, so a link cannot be found by walking through them.
sharedTradeSchema.statics.newCode = function () {
  const bytes = crypto.randomBytes(8)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

export default mongoose.model('SharedTrade', sharedTradeSchema)
