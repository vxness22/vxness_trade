// One-time email setup script (self-contained — no other code changes needed).
// Configures Hostinger SMTP, enables it, enables all existing email templates,
// then verifies the SMTP connection.
//
// Run from the backend/ directory so dotenv picks up backend/.env:
//   cd ~/actions-runner/_work/vxness/vxness/backend
//   SMTP_PASS='your-mailbox-password' node scripts/setupEmail.js
//
// The mailbox password is read from the SMTP_PASS env var on purpose so it is
// never written into a file or committed to git. Wrap it in single quotes — the
// password may contain shell-special characters like | & ; ^.

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import EmailSettings from '../models/EmailSettings.js'
import EmailTemplate from '../models/EmailTemplate.js'
import { testSMTPConnection } from '../services/emailService.js'

dotenv.config()

// ---- Edit these if your mailbox / brand changes ----
const SMTP_HOST = 'smtp.hostinger.com'
const SMTP_PORT = 465 // 465 = SSL. Try 587 if 465 is blocked by the host firewall.
const SMTP_USER = 'support@vxness.com'
const FROM_EMAIL = 'support@vxness.com'
const FROM_NAME = 'Vxness Support'
// -----------------------------------------------------

const run = async () => {
  const smtpPass = process.env.SMTP_PASS
  if (!smtpPass) {
    console.error('ERROR: SMTP_PASS env var is required.')
    console.error("Run as:  SMTP_PASS='your-password' node scripts/setupEmail.js")
    process.exit(1)
  }
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not found. Run from the backend/ directory so backend/.env loads.')
    process.exit(1)
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('Connected to MongoDB')

    // 1. Upsert SMTP settings and enable them (+ OTP on signup)
    let settings = await EmailSettings.findOne()
    if (!settings) settings = new EmailSettings()
    settings.smtpHost = SMTP_HOST
    settings.smtpPort = SMTP_PORT
    settings.smtpUser = SMTP_USER
    settings.smtpPass = smtpPass
    settings.smtpSecure = SMTP_PORT === 465
    settings.fromEmail = FROM_EMAIL
    settings.fromName = FROM_NAME
    settings.smtpEnabled = true
    settings.otpVerificationEnabled = true
    await settings.save()
    console.log(`SMTP saved & enabled  (from: ${FROM_NAME} <${FROM_EMAIL}>, host ${SMTP_HOST}:${SMTP_PORT})`)

    // 2. Enable every email template that exists in the DB
    const total = await EmailTemplate.countDocuments()
    if (total === 0) {
      console.warn('\n⚠️  No templates found in DB. Open the admin panel → Email Templates → click "Seed",')
      console.warn('    then run this script again (or the emails will be skipped: "Template not found").')
    } else {
      const res = await EmailTemplate.updateMany({}, { $set: { isEnabled: true } })
      console.log(`Templates: ${total} found, enabled all (${res.modifiedCount ?? res.nModified ?? 0} updated)`)
    }

    // 3. Verify the SMTP connection (auth + TLS handshake)
    const test = await testSMTPConnection()
    console.log('SMTP connection test:', test.success ? 'SUCCESS ✅' : `FAILED ❌ — ${test.message}`)

    await mongoose.disconnect()
    console.log('\nDone. Disconnected from MongoDB.')
    process.exit(test.success ? 0 : 2)
  } catch (error) {
    console.error('Setup error:', error.message)
    await mongoose.disconnect()
    process.exit(1)
  }
}

run()
