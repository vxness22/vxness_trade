import express from 'express'
import EmailTemplate from '../models/EmailTemplate.js'
import EmailSettings from '../models/EmailSettings.js'
import { testSMTPConnection } from '../services/emailService.js'
import defaultTemplates from './emailTemplateDefaults.js'

const router = express.Router()

// GET /api/email-templates - Get all templates
router.get('/', async (req, res) => {
  try {
    const templates = await EmailTemplate.find().sort({ category: 1, name: 1 })
    res.json({ success: true, templates })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/email-templates/:id - Get single template
router.get('/:id', async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id)
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }
    res.json({ success: true, template })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/email-templates/:id - Update template
router.put('/:id', async (req, res) => {
  try {
    const { subject, htmlContent, isEnabled } = req.body
    const template = await EmailTemplate.findByIdAndUpdate(
      req.params.id,
      { subject, htmlContent, isEnabled },
      { new: true }
    )
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }
    res.json({ success: true, template, message: 'Template updated successfully' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/email-templates/:id/toggle - Toggle template enabled status
router.put('/:id/toggle', async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id)
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }
    template.isEnabled = !template.isEnabled
    await template.save()
    res.json({ success: true, template, message: `Template ${template.isEnabled ? 'enabled' : 'disabled'}` })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/email-templates/seed - Seed default templates
router.post('/seed', async (req, res) => {
  try {
    for (const template of defaultTemplates) {
      await EmailTemplate.findOneAndUpdate(
        { slug: template.slug },
        template,
        { upsert: true, new: true }
      )
    }
    res.json({ success: true, message: 'Default templates seeded successfully' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/email-templates/settings/smtp - Get email settings
router.get('/settings/smtp', async (req, res) => {
  try {
    let settings = await EmailSettings.findOne()
    if (!settings) {
      settings = await EmailSettings.create({})
    }
    // Don't send password in response
    const safeSettings = {
      ...settings.toObject(),
      smtpPass: settings.smtpPass ? '********' : ''
    }
    res.json({ success: true, settings: safeSettings })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/email-templates/settings/smtp - Update email settings
router.put('/settings/smtp', async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure, fromEmail, fromName, otpVerificationEnabled, otpExpiryMinutes } = req.body

    let settings = await EmailSettings.findOne()
    if (!settings) {
      settings = new EmailSettings()
    }

    settings.smtpHost = smtpHost
    settings.smtpPort = smtpPort
    settings.smtpUser = smtpUser
    if (smtpPass && smtpPass !== '********') {
      settings.smtpPass = smtpPass
    }
    settings.smtpSecure = smtpSecure
    settings.fromEmail = fromEmail
    settings.fromName = fromName
    if (otpVerificationEnabled !== undefined) {
      settings.otpVerificationEnabled = otpVerificationEnabled
    }
    if (otpExpiryMinutes !== undefined) {
      settings.otpExpiryMinutes = otpExpiryMinutes
    }

    await settings.save()
    res.json({ success: true, message: 'Email settings updated successfully' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/email-templates/settings/toggle-smtp - Toggle SMTP on/off
router.put('/settings/toggle-smtp', async (req, res) => {
  try {
    let settings = await EmailSettings.findOne()
    if (!settings) {
      settings = new EmailSettings()
    }
    settings.smtpEnabled = !settings.smtpEnabled
    await settings.save()
    res.json({
      success: true,
      smtpEnabled: settings.smtpEnabled,
      message: settings.smtpEnabled ? 'SMTP enabled' : 'SMTP disabled'
    })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/email-templates/settings/test - Test SMTP connection
router.post('/settings/test', async (req, res) => {
  try {
    const result = await testSMTPConnection()
    res.json(result)
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/email-templates/settings/send-test - Send a test email
router.post('/settings/send-test', async (req, res) => {
  try {
    const { toEmail } = req.body
    if (!toEmail) {
      return res.status(400).json({ success: false, message: 'Email address is required' })
    }

    const settings = await EmailSettings.findOne()
    if (!settings || !settings.smtpHost) {
      return res.status(400).json({ success: false, message: 'SMTP settings not configured' })
    }

    const nodemailer = await import('nodemailer')

    // Port 465 = SSL, Port 587 = STARTTLS (secure should be false)
    const useSecure = settings.smtpPort === 465 ? true : settings.smtpSecure

    const transporter = nodemailer.default.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: useSecure,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPass
      },
      tls: {
        rejectUnauthorized: false
      }
    })

    const mailOptions = {
      from: '"' + settings.fromName + '" <' + settings.fromEmail + '>',
      to: toEmail,
      subject: 'Test Email - SMTP Configuration Working!',
      html: '<!DOCTYPE html><html><body style="margin: 0; padding: 40px; background-color: #0a0a0a; font-family: Arial, sans-serif;"><div style="max-width: 500px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 40px; border: 1px solid #333;"><h1 style="color: #22c55e; margin: 0 0 20px; text-align: center;">✓ Test Successful!</h1><p style="color: #aaa; margin: 0 0 20px; line-height: 1.6; text-align: center;">Your SMTP configuration is working correctly.</p><div style="background: #0f0f23; border-radius: 8px; padding: 15px; margin-bottom: 20px;"><p style="color: #888; margin: 0 0 5px; font-size: 12px;">SMTP Host</p><p style="color: #fff; margin: 0;">' + settings.smtpHost + ':' + settings.smtpPort + '</p></div><p style="color: #666; font-size: 12px; margin: 0; text-align: center;">Sent at ' + new Date().toLocaleString() + '</p></div></body></html>'
    }

    await transporter.sendMail(mailOptions)
    res.json({ success: true, message: 'Test email sent to ' + toEmail })
  } catch (error) {
    console.error('Send test email error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/email-templates/:id/test - Send a test email using specific template
router.post('/:id/test', async (req, res) => {
  try {
    const { toEmail } = req.body
    if (!toEmail) {
      return res.status(400).json({ success: false, message: 'Email address is required' })
    }

    const template = await EmailTemplate.findById(req.params.id)
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    const settings = await EmailSettings.findOne()
    if (!settings || !settings.smtpHost) {
      return res.status(400).json({ success: false, message: 'SMTP settings not configured' })
    }

    const nodemailer = await import('nodemailer')
    const useSecure = settings.smtpPort === 465

    const transporter = nodemailer.default.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: useSecure,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPass
      },
      tls: { rejectUnauthorized: false }
    })

    // Generate sample data for template variables
    const sampleData = {
      firstName: 'John',
      email: toEmail,
      otp: '123456',
      expiryMinutes: '10',
      amount: '500.00',
      transactionId: 'TXN' + Date.now(),
      paymentMethod: 'Bank Transfer',
      date: new Date().toLocaleDateString(),
      newBalance: '1,500.00',
      platformName: settings.fromName || 'Trading Platform',
      supportEmail: settings.fromEmail || 'support@example.com',
      loginUrl: 'http://localhost:5173/login',
      reason: 'Violation of terms of service',
      rejectionReason: 'Document was blurry or unreadable',
      documentType: 'Passport',
      submittedAt: new Date().toLocaleDateString(),
      approvedAt: new Date().toLocaleDateString(),
      rejectedAt: new Date().toLocaleDateString(),
      challengeName: '10K Evaluation',
      fundSize: '10,000',
      accountId: '12345678',
      fee: '99.00',
      purchaseDate: new Date().toLocaleDateString(),
      completionDate: new Date().toLocaleDateString(),
      failureDate: new Date().toLocaleDateString(),
      failureReason: 'Daily drawdown limit exceeded',
      year: new Date().getFullYear().toString()
    }

    // Replace variables in template
    let subject = template.subject
    let html = template.htmlContent
    for (const [key, value] of Object.entries(sampleData)) {
      const regex = new RegExp('{{' + key + '}}', 'g')
      subject = subject.replace(regex, value)
      html = html.replace(regex, value)
    }

    const mailOptions = {
      from: '"' + settings.fromName + '" <' + settings.fromEmail + '>',
      to: toEmail,
      subject: '[TEST] ' + subject,
      html: html
    }

    await transporter.sendMail(mailOptions)
    res.json({ success: true, message: 'Test email sent to ' + toEmail })
  } catch (error) {
    console.error('Send template test email error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/email-templates/:id - Delete a template
router.delete('/:id', async (req, res) => {
  try {
    const template = await EmailTemplate.findByIdAndDelete(req.params.id)
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }
    res.json({ success: true, message: 'Template deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/email-templates/reset - Reset all templates (delete all and reseed)
router.post('/reset', async (req, res) => {
  try {
    await EmailTemplate.deleteMany({})
    for (const template of defaultTemplates) {
      await EmailTemplate.create(template)
    }
    res.json({ success: true, message: 'All templates reset to defaults' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/email-templates/sync - Sync templates (add missing, update existing)
router.post('/sync', async (req, res) => {
  try {
    let added = 0
    let updated = 0
    for (const template of defaultTemplates) {
      const existing = await EmailTemplate.findOne({ slug: template.slug })
      if (existing) {
        // Update only if not customized (check if htmlContent matches default)
        updated++
      } else {
        await EmailTemplate.create(template)
        added++
      }
    }
    res.json({ success: true, message: `Sync complete: ${added} added, ${updated} existing` })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
