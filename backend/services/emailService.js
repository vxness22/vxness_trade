import nodemailer from 'nodemailer'
import EmailSettings from '../models/EmailSettings.js'
import EmailTemplate from '../models/EmailTemplate.js'

let transporter = null

// Initialize or get transporter
const getTransporter = async () => {
  const settings = await EmailSettings.findOne()
  
  if (!settings || !settings.smtpHost || !settings.smtpUser) {
    return null
  }

  // Port 465 = SSL (secure: true), Port 587 = STARTTLS (secure: false)
  const useSecure = settings.smtpPort === 465

  transporter = nodemailer.createTransport({
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

  return transporter
}

// Replace template variables
const replaceVariables = (content, variables) => {
  let result = content
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g')
    result = result.replace(regex, value || '')
  }
  return result
}

// Send email using template
export const sendTemplateEmail = async (templateSlug, toEmail, variables = {}) => {
  try {
    const settings = await EmailSettings.findOne()
    
    // Check if SMTP is enabled
    if (!settings || !settings.smtpEnabled) {
      console.log('SMTP is disabled, skipping email')
      return { success: false, message: 'SMTP is disabled' }
    }
    
    if (!settings.smtpHost) {
      console.log('Email settings not configured')
      return { success: false, message: 'Email settings not configured' }
    }

    const template = await EmailTemplate.findOne({ slug: templateSlug })
    if (!template) {
      console.log(`Template not found: ${templateSlug}`)
      return { success: false, message: 'Template not found' }
    }

    if (!template.isEnabled) {
      console.log(`Template disabled: ${templateSlug}`)
      return { success: false, message: 'Template is disabled' }
    }

    const transport = await getTransporter()
    if (!transport) {
      return { success: false, message: 'Failed to create email transport' }
    }

    const subject = replaceVariables(template.subject, variables)
    const html = replaceVariables(template.htmlContent, variables)

    const mailOptions = {
      from: `"${settings.fromName}" <${settings.fromEmail}>`,
      to: toEmail,
      subject: subject,
      html: html
    }

    const info = await transport.sendMail(mailOptions)
    console.log('Email sent:', info.messageId)
    
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('Error sending email:', error)
    return { success: false, message: error.message }
  }
}

// Send a plain OTP email directly (no template dependency). Used for admin login
// 2FA so it works as soon as SMTP is configured, without seeding email templates.
export const sendOtpDirect = async (toEmail, otp, expiryMinutes = 10) => {
  try {
    const settings = await EmailSettings.findOne()
    if (!settings || !settings.smtpHost || !settings.smtpUser) {
      return { success: false, message: 'SMTP not configured' }
    }

    const transport = await getTransporter()
    if (!transport) {
      return { success: false, message: 'Failed to create email transport' }
    }

    const fromName = settings.fromName || 'Vxness'
    const fromEmail = settings.fromEmail || settings.smtpUser
    const logoUrl = process.env.EMAIL_LOGO_URL || 'https://vxness.in/logo.png'

    // Same centered-logo design as the other Vxness email templates.
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#12131a;border:1px solid #23262f;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr><td align="center" style="padding:36px 40px 0;">
          <a href="https://vxness.in" target="_blank" style="text-decoration:none;border:0;outline:none;"><img src="${logoUrl}" alt="Vxness" width="150" draggable="false" style="display:block;margin:0 auto;width:150px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;pointer-events:none;-webkit-user-select:none;-moz-user-select:none;user-select:none;"></a>
        </td></tr>
        <tr><td align="center" style="padding:18px 40px 0;">
          <div style="width:48px;height:3px;background:#22c55e;border-radius:3px;font-size:0;line-height:0;">&nbsp;</div>
        </td></tr>
        <tr><td style="padding:22px 40px 0;">
          <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0 0 6px;text-align:center;">Admin Login Verification</h1>
          <p style="color:#8b909c;font-size:14px;margin:0;text-align:center;">Use the code below to sign in</p>
        </td></tr>
        <tr><td style="padding:22px 40px 8px;color:#c7ccd6;font-size:15px;line-height:1.7;">
          <div style="background:#0d0e14;border:1px dashed #22c55e;border-radius:12px;padding:22px;text-align:center;margin:8px 0 14px;">
            <div style="color:#8b909c;font-size:12px;letter-spacing:2px;margin-bottom:10px;">VERIFICATION CODE</div>
            <div style="color:#22c55e;font-size:34px;font-weight:700;letter-spacing:10px;">${otp}</div>
          </div>
          <p style="margin:0;color:#8b909c;font-size:13px;text-align:center;">This code expires in ${expiryMinutes} minutes. If you didn't request it, please ignore this email.</p>
        </td></tr>
        <tr><td style="padding:20px 40px 34px;">
          <div style="border-top:1px solid #23262f;padding-top:20px;text-align:center;">
            <p style="color:#5b606b;font-size:12px;margin:0;">© ${new Date().getFullYear()} ${fromName}. All rights reserved.</p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

    const info = await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: toEmail,
      subject: `Your admin login OTP: ${otp}`,
      html
    })

    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('Error sending OTP email:', error)
    return { success: false, message: error.message }
  }
}

// Generate OTP
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Check if OTP verification is enabled (requires both SMTP and OTP to be enabled)
export const isOTPEnabled = async () => {
  const settings = await EmailSettings.findOne()
  // OTP is only enabled if both SMTP is enabled AND OTP verification is enabled
  if (!settings) return false
  return settings.smtpEnabled && settings.otpVerificationEnabled
}

// Get OTP expiry in minutes
export const getOTPExpiry = () => {
  return 10 // Default 10 minutes
}

// Test SMTP connection
export const testSMTPConnection = async () => {
  try {
    const transport = await getTransporter()
    if (!transport) {
      return { success: false, message: 'SMTP not configured' }
    }
    
    await transport.verify()
    return { success: true, message: 'SMTP connection successful' }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

export default {
  sendTemplateEmail,
  generateOTP,
  isOTPEnabled,
  getOTPExpiry,
  testSMTPConnection
}
