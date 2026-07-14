// Default email templates — shared, consistent design with a centered Vxness logo.
// All templates are composed from a single `shell()` so branding stays uniform.
// The logo is loaded from the public site; override with EMAIL_LOGO_URL if needed.

const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://vxness.in/logo.png'
const SITE_URL = process.env.EMAIL_SITE_URL || 'https://vxness.in'

const C = {
  bg: '#0a0a0a',
  card: '#12131a',
  inner: '#0d0e14',
  border: '#23262f',
  text: '#c7ccd6',
  heading: '#ffffff',
  muted: '#8b909c',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6'
}

// Page shell: centered logo header, accent bar, heading, body, footer.
const shell = ({ accent = C.green, heading, subheading = '', bodyHtml, preheader = '' }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${C.card};border:1px solid ${C.border};border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr><td align="center" style="padding:36px 40px 0;">
          <a href="${SITE_URL}" target="_blank" style="text-decoration:none;border:0;outline:none;"><img src="${LOGO_URL}" alt="Vxness" width="150" style="display:block;margin:0 auto;width:150px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;pointer-events:auto;"></a>
        </td></tr>
        <tr><td align="center" style="padding:18px 40px 0;">
          <div style="width:48px;height:3px;background:${accent};border-radius:3px;font-size:0;line-height:0;">&nbsp;</div>
        </td></tr>
        <tr><td style="padding:22px 40px 0;">
          <h1 style="color:${C.heading};font-size:22px;font-weight:700;margin:0 0 6px;text-align:center;">${heading}</h1>
          ${subheading ? `<p style="color:${C.muted};font-size:14px;margin:0;text-align:center;">${subheading}</p>` : ''}
        </td></tr>
        <tr><td style="padding:22px 40px 8px;color:${C.text};font-size:15px;line-height:1.7;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 40px 34px;">
          <div style="border-top:1px solid ${C.border};padding-top:20px;text-align:center;">
            <p style="color:${C.muted};font-size:13px;margin:0 0 6px;">Need help? Contact us at <a href="mailto:{{supportEmail}}" style="color:${accent};text-decoration:none;">{{supportEmail}}</a></p>
            <p style="color:#5b606b;font-size:12px;margin:0;">© {{year}} {{platformName}}. All rights reserved.</p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

const greet = `<p style="margin:0 0 14px;">Hi {{firstName}},</p>`

// Key/value details box. rows = [[label, value], ...]
const dataBox = (rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.inner};border:1px solid ${C.border};border-radius:12px;margin:6px 0 10px;">
  ${rows.map(([label, value], i) => `<tr>
    <td style="padding:12px 16px;color:${C.muted};font-size:13px;${i < rows.length - 1 ? `border-bottom:1px solid ${C.border};` : ''}">${label}</td>
    <td style="padding:12px 16px;color:${C.heading};font-size:14px;font-weight:600;text-align:right;${i < rows.length - 1 ? `border-bottom:1px solid ${C.border};` : ''}">${value}</td>
  </tr>`).join('')}
</table>`

// Centered call-to-action button.
const button = (url, text, accent = C.green) => `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 12px;"><tr><td align="center" style="border-radius:10px;background:${accent};">
  <a href="${url}" style="display:inline-block;padding:13px 38px;color:#0a0a0a;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">${text}</a>
</td></tr></table>`

// Big verification-code block.
const codeBox = (accent = C.green) => `<div style="background:${C.inner};border:1px dashed ${accent};border-radius:12px;padding:22px;text-align:center;margin:8px 0 14px;">
  <div style="color:${C.muted};font-size:12px;letter-spacing:2px;margin-bottom:10px;">VERIFICATION CODE</div>
  <div style="color:${accent};font-size:34px;font-weight:700;letter-spacing:10px;">{{otp}}</div>
</div>`

// Highlighted note (e.g. rejection reason).
const noteBox = (accent, label, value) => `<div style="background:${C.inner};border-left:3px solid ${accent};border-radius:8px;padding:14px 16px;margin:10px 0;">
  <div style="color:${C.muted};font-size:12px;margin-bottom:4px;">${label}</div>
  <div style="color:${C.heading};font-size:14px;line-height:1.5;">${value}</div>
</div>`

const defaultTemplates = [
  {
    name: 'Email Verification OTP',
    slug: 'email_verification',
    subject: 'Verify Your Email - {{otp}}',
    description: 'Sent with a one-time code to verify a user\'s email',
    category: 'verification',
    variables: ['otp', 'firstName', 'email', 'expiryMinutes', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.green,
      heading: 'Verify Your Email',
      subheading: 'Enter the code below to continue',
      preheader: 'Your Vxness verification code',
      bodyHtml: `${greet}
        <p style="margin:0 0 8px;">Use this one-time code to verify your email address:</p>
        ${codeBox(C.green)}
        <p style="margin:0;color:${C.muted};font-size:13px;">This code expires in {{expiryMinutes}} minutes. If you didn't request it, you can safely ignore this email.</p>`
    })
  },
  {
    name: 'Password Reset',
    slug: 'password_reset',
    subject: 'Reset Your Password - {{otp}}',
    description: 'Sent with a one-time code to reset a password',
    category: 'verification',
    variables: ['firstName', 'email', 'otp', 'expiryMinutes', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.blue,
      heading: 'Reset Your Password',
      subheading: 'Use the code below to set a new password',
      preheader: 'Your Vxness password reset code',
      bodyHtml: `${greet}
        <p style="margin:0 0 8px;">We received a request to reset the password for <b style="color:${C.heading};">{{email}}</b>. Use this code:</p>
        ${codeBox(C.blue)}
        <p style="margin:0;color:${C.muted};font-size:13px;">This code expires in {{expiryMinutes}} minutes. If you didn't request a reset, please ignore this email or contact support.</p>`
    })
  },
  {
    name: 'Welcome Email',
    slug: 'welcome',
    subject: 'Welcome to {{platformName}}!',
    description: 'Sent after an account is created',
    category: 'account',
    variables: ['firstName', 'email', 'platformName', 'loginUrl', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.green,
      heading: '🎉 Welcome Aboard!',
      subheading: 'Your account is ready',
      preheader: 'Welcome to Vxness — start trading today',
      bodyHtml: `${greet}
        <p style="margin:0 0 10px;">Your account has been created successfully. You're all set to start trading.</p>
        ${dataBox([['Registered email', '{{email}}']])}
        ${button('{{loginUrl}}', 'Start Trading', C.green)}
        <p style="margin:6px 0 0;color:${C.muted};font-size:13px;">Tip: complete your KYC to unlock deposits, withdrawals and full trading access.</p>`
    })
  },
  {
    name: 'Deposit Pending',
    slug: 'deposit_pending',
    subject: 'Deposit Request Received - ${{amount}}',
    description: 'Sent when a deposit request is submitted',
    category: 'transaction',
    variables: ['firstName', 'amount', 'transactionId', 'paymentMethod', 'date', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.amber,
      heading: 'Deposit Request Received',
      subheading: 'Your deposit is being reviewed',
      preheader: 'We received your deposit request',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">We've received your deposit request and it's now pending approval.</p>
        ${dataBox([['Amount', '&#36;{{amount}}'], ['Payment method', '{{paymentMethod}}'], ['Transaction ID', '{{transactionId}}'], ['Date', '{{date}}']])}
        <p style="margin:0;color:${C.muted};font-size:13px;">You'll get another email as soon as it's approved. This usually takes a short while.</p>`
    })
  },
  {
    name: 'Deposit Success',
    slug: 'deposit_success',
    subject: 'Deposit Approved - ${{amount}} Added!',
    description: 'Sent when a deposit is approved',
    category: 'transaction',
    variables: ['firstName', 'amount', 'transactionId', 'paymentMethod', 'date', 'newBalance', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.green,
      heading: '✅ Deposit Approved',
      subheading: 'Funds added to your wallet',
      preheader: 'Your deposit has been approved',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Great news — your deposit has been approved and added to your wallet.</p>
        ${dataBox([['Amount added', '&#36;{{amount}}'], ['New balance', '&#36;{{newBalance}}'], ['Payment method', '{{paymentMethod}}'], ['Transaction ID', '{{transactionId}}'], ['Date', '{{date}}']])}
        <p style="margin:0;color:${C.muted};font-size:13px;">You're ready to trade. Good luck!</p>`
    })
  },
  {
    name: 'Deposit Rejected',
    slug: 'deposit_rejected',
    subject: 'Deposit Request Declined - ${{amount}}',
    description: 'Sent when a deposit request is rejected',
    category: 'transaction',
    variables: ['firstName', 'amount', 'transactionId', 'paymentMethod', 'date', 'reason', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.red,
      heading: 'Deposit Request Declined',
      subheading: 'Your deposit could not be processed',
      preheader: 'Your deposit request was declined',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Unfortunately, your deposit request could not be processed.</p>
        ${dataBox([['Amount', '&#36;{{amount}}'], ['Payment method', '{{paymentMethod}}'], ['Transaction ID', '{{transactionId}}'], ['Date', '{{date}}']])}
        ${noteBox(C.red, 'Reason', '{{reason}}')}
        <p style="margin:0;color:${C.muted};font-size:13px;">No funds were deducted. If you think this is a mistake, please contact our support team.</p>`
    })
  },
  {
    name: 'Withdrawal Pending',
    slug: 'withdrawal_pending',
    subject: 'Withdrawal Request Received - ${{amount}}',
    description: 'Sent when a withdrawal request is submitted',
    category: 'transaction',
    variables: ['firstName', 'amount', 'transactionId', 'paymentMethod', 'date', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.amber,
      heading: 'Withdrawal Request Received',
      subheading: 'Your withdrawal is being processed',
      preheader: 'We received your withdrawal request',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">We've received your withdrawal request and it's now pending review.</p>
        ${dataBox([['Amount', '&#36;{{amount}}'], ['Payment method', '{{paymentMethod}}'], ['Transaction ID', '{{transactionId}}'], ['Date', '{{date}}']])}
        <p style="margin:0;color:${C.muted};font-size:13px;">You'll be notified once it's processed. The amount is on hold until then.</p>`
    })
  },
  {
    name: 'Withdrawal Success',
    slug: 'withdrawal_success',
    subject: 'Withdrawal Completed - ${{amount}}',
    description: 'Sent when a withdrawal is approved',
    category: 'transaction',
    variables: ['firstName', 'amount', 'transactionId', 'paymentMethod', 'date', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.green,
      heading: '✅ Withdrawal Completed',
      subheading: 'Your funds are on the way',
      preheader: 'Your withdrawal has been processed',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Your withdrawal has been approved and processed successfully.</p>
        ${dataBox([['Amount', '&#36;{{amount}}'], ['Payment method', '{{paymentMethod}}'], ['Transaction ID', '{{transactionId}}'], ['Date', '{{date}}']])}
        <p style="margin:0;color:${C.muted};font-size:13px;">Depending on your payment provider, it may take some time to reflect in your account.</p>`
    })
  },
  {
    name: 'Withdrawal Rejected',
    slug: 'withdrawal_rejected',
    subject: 'Withdrawal Request Declined - ${{amount}}',
    description: 'Sent when a withdrawal request is rejected',
    category: 'transaction',
    variables: ['firstName', 'amount', 'transactionId', 'paymentMethod', 'date', 'reason', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.red,
      heading: 'Withdrawal Request Declined',
      subheading: 'Your withdrawal could not be processed',
      preheader: 'Your withdrawal request was declined',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Unfortunately, your withdrawal request has been declined.</p>
        ${dataBox([['Amount', '&#36;{{amount}}'], ['Payment method', '{{paymentMethod}}'], ['Transaction ID', '{{transactionId}}'], ['Date', '{{date}}']])}
        ${noteBox(C.red, 'Reason', '{{reason}}')}
        <p style="margin:0;color:${C.muted};font-size:13px;">The amount has been refunded to your wallet balance. If you have questions, contact support.</p>`
    })
  },
  {
    name: 'KYC Submitted',
    slug: 'kyc_submitted',
    subject: '📄 KYC Documents Submitted - Under Review',
    description: 'Sent when KYC documents are submitted',
    category: 'verification',
    variables: ['firstName', 'email', 'documentType', 'submittedAt', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.amber,
      heading: '📄 KYC Under Review',
      subheading: 'We received your documents',
      preheader: 'Your KYC documents are under review',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Thanks for submitting your verification documents. Our team is reviewing them.</p>
        ${dataBox([['Document type', '{{documentType}}'], ['Submitted on', '{{submittedAt}}']])}
        <p style="margin:0;color:${C.muted};font-size:13px;">You'll receive an email once the review is complete. This usually takes 24–48 hours.</p>`
    })
  },
  {
    name: 'KYC Approved',
    slug: 'kyc_approved',
    subject: '✅ KYC Verified - Account Fully Activated',
    description: 'Sent when KYC is approved',
    category: 'verification',
    variables: ['firstName', 'email', 'documentType', 'approvedAt', 'platformName', 'loginUrl', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.green,
      heading: '✅ KYC Verified',
      subheading: 'Your account is fully activated',
      preheader: 'Your KYC has been approved',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Congratulations! Your identity has been verified and your account is now fully activated.</p>
        ${dataBox([['Document type', '{{documentType}}'], ['Approved on', '{{approvedAt}}']])}
        <p style="margin:0 0 4px;">You now have full access to deposits, withdrawals and trading.</p>
        ${button('{{loginUrl}}', 'Go to Dashboard', C.green)}`
    })
  },
  {
    name: 'KYC Rejected',
    slug: 'kyc_rejected',
    subject: '❌ KYC Verification Failed - Action Required',
    description: 'Sent when KYC is rejected',
    category: 'verification',
    variables: ['firstName', 'email', 'documentType', 'rejectionReason', 'rejectedAt', 'platformName', 'loginUrl', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.red,
      heading: 'KYC Verification Failed',
      subheading: 'Action required',
      preheader: 'Your KYC needs to be resubmitted',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Unfortunately, we couldn't verify your submitted documents.</p>
        ${dataBox([['Document type', '{{documentType}}'], ['Reviewed on', '{{rejectedAt}}']])}
        ${noteBox(C.red, 'Reason', '{{rejectionReason}}')}
        <p style="margin:0 0 4px;">Please review the reason above and resubmit clear, valid documents.</p>
        ${button('{{loginUrl}}', 'Resubmit KYC', C.red)}`
    })
  },
  {
    name: 'Challenge Purchased',
    slug: 'challenge_purchased',
    subject: '🚀 Challenge Purchased - {{challengeName}}',
    description: 'Sent when a user purchases a prop-firm challenge',
    category: 'notification',
    variables: ['firstName', 'challengeName', 'fundSize', 'accountId', 'fee', 'purchaseDate', 'platformName', 'loginUrl', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.green,
      heading: '🚀 Challenge Activated',
      subheading: 'Your evaluation account is ready',
      preheader: 'Your prop-firm challenge is now active',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Your challenge has been purchased and your trading account is ready to go.</p>
        ${dataBox([['Challenge', '{{challengeName}}'], ['Account size', '{{fundSize}}'], ['Account ID', '{{accountId}}'], ['Fee paid', '{{fee}}'], ['Date', '{{purchaseDate}}']])}
        <p style="margin:0 0 4px;">Trade within the rules to pass your evaluation and get funded.</p>
        ${button('{{loginUrl}}', 'Start Challenge', C.green)}`
    })
  },
  {
    name: 'Challenge Completed',
    slug: 'challenge_completed',
    subject: '🎉 Congratulations! Challenge Completed Successfully',
    description: 'Sent when a challenge is passed',
    category: 'notification',
    variables: ['firstName', 'challengeName', 'fundSize', 'accountId', 'completionDate', 'platformName', 'loginUrl', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.green,
      heading: '🎉 Challenge Passed!',
      subheading: 'You did it — congratulations',
      preheader: 'You passed your challenge',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Congratulations! You've successfully completed your challenge and met all the objectives.</p>
        ${dataBox([['Challenge', '{{challengeName}}'], ['Account size', '{{fundSize}}'], ['Account ID', '{{accountId}}'], ['Completed on', '{{completionDate}}']])}
        ${button('{{loginUrl}}', 'View Account', C.green)}`
    })
  },
  {
    name: 'Challenge Failed',
    slug: 'challenge_failed',
    subject: '⚠️ Challenge Failed - Try Again',
    description: 'Sent when a challenge is failed',
    category: 'notification',
    variables: ['firstName', 'challengeName', 'fundSize', 'accountId', 'failureReason', 'failureDate', 'platformName', 'loginUrl', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.red,
      heading: 'Challenge Failed',
      subheading: 'Don\'t give up — try again',
      preheader: 'Your challenge did not pass',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Unfortunately, your challenge did not pass this time.</p>
        ${dataBox([['Challenge', '{{challengeName}}'], ['Account size', '{{fundSize}}'], ['Account ID', '{{accountId}}'], ['Date', '{{failureDate}}']])}
        ${noteBox(C.red, 'Reason', '{{failureReason}}')}
        <p style="margin:0 0 4px;">Every great trader faces setbacks. Learn from it and take on a new challenge.</p>
        ${button('{{loginUrl}}', 'Try Again', C.red)}`
    })
  },
  {
    name: 'Account Banned',
    slug: 'account_banned',
    subject: 'Account Suspended - Action Required',
    description: 'Sent when an account is suspended',
    category: 'account',
    variables: ['firstName', 'email', 'reason', 'date', 'platformName', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.red,
      heading: 'Account Suspended',
      subheading: 'Action required',
      preheader: 'Your account has been suspended',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Your account (<b style="color:${C.heading};">{{email}}</b>) has been suspended.</p>
        ${noteBox(C.red, 'Reason', '{{reason}}')}
        ${dataBox([['Date', '{{date}}']])}
        <p style="margin:0;color:${C.muted};font-size:13px;">If you believe this was a mistake, please contact our support team to resolve it.</p>`
    })
  },
  {
    name: 'Account Unbanned',
    slug: 'account_unbanned',
    subject: 'Account Reactivated - Welcome Back!',
    description: 'Sent when an account is reactivated',
    category: 'account',
    variables: ['firstName', 'email', 'date', 'platformName', 'loginUrl', 'supportEmail', 'year'],
    htmlContent: shell({
      accent: C.green,
      heading: '✅ Account Reactivated',
      subheading: 'Welcome back',
      preheader: 'Your account has been reactivated',
      bodyHtml: `${greet}
        <p style="margin:0 0 6px;">Good news — your account (<b style="color:${C.heading};">{{email}}</b>) has been reactivated. You can log in again.</p>
        ${dataBox([['Reactivated on', '{{date}}']])}
        ${button('{{loginUrl}}', 'Log In', C.green)}`
    })
  }
]

export default defaultTemplates
export { defaultTemplates }
