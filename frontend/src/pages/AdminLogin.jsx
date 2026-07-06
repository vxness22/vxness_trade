import { useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { X, Mail, KeyRound, ArrowLeft } from 'lucide-react'
import logo from '../assets/logo.png'
import { API_URL } from '../config/api'

const AdminLogin = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('email') // 'email' | 'otp'
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')

  // Persist session + go to dashboard
  const completeLogin = (data) => {
    localStorage.setItem('adminToken', data.token)
    localStorage.setItem('adminUser', JSON.stringify(data.admin))
    toast.success('Admin login successful!')
    navigate('/admin/dashboard')
  }

  // Step 1: submit admin email -> server sends OTP to authorized admin inbox
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Please enter the admin email')
      return
    }
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_URL}/admin-mgmt/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })

      const data = await response.json()

      if (data.success && data.otpRequired) {
        setStep('otp')
        toast.success('OTP sent to the authorized admin email')
      } else if (data.success && data.token) {
        // Backward-compat: if a token is ever returned directly, log in.
        completeLogin(data)
      } else {
        setError(data.message || 'Invalid admin credentials')
      }
    } catch (err) {
      console.error('Login error:', err)
      setError('Failed to connect to server')
    }

    setLoading(false)
  }

  // Step 2: verify OTP -> receive token + admin
  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    if (!otp.trim()) {
      setError('Please enter the OTP')
      return
    }
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_URL}/admin-mgmt/verify-login-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          otp: otp.trim()
        })
      })

      const data = await response.json()

      if (data.success && data.token) {
        completeLogin(data)
      } else {
        setError(data.message || 'Invalid OTP')
      }
    } catch (err) {
      console.error('OTP verify error:', err)
      setError('Failed to connect to server')
    }

    setLoading(false)
  }

  // Resend the OTP by re-running step 1
  const handleResend = async () => {
    setOtp('')
    await handleSubmit({ preventDefault: () => {} })
  }

  const goBack = () => {
    setStep('email')
    setOtp('')
    setError('')
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-r from-red-500/20 to-transparent rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-gradient-to-l from-purple-500/20 via-red-500/20 to-transparent rounded-full blur-3xl" />

      {/* Modal */}
      <div className="relative bg-dark-700 rounded-2xl p-6 sm:p-8 w-full max-w-md border border-gray-800 mx-4 sm:mx-0">
        {/* Close button */}
        <button
          onClick={() => navigate('/')}
          className="absolute top-4 right-4 w-8 h-8 bg-dark-600 rounded-full flex items-center justify-center hover:bg-dark-500 transition-colors"
        >
          <X size={16} className="text-gray-400" />
        </button>

        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img src={logo} alt="Vxness" className="h-16 object-contain" />
        </div>

        {/* Admin Badge */}
        <div className="flex items-center gap-2 mb-6">
          <div className="px-3 py-1 bg-red-500/20 text-red-500 rounded-full text-sm font-medium">
            Admin Portal
          </div>
        </div>

        {step === 'email' ? (
          <>
            {/* Title */}
            <h1 className="text-2xl font-semibold text-white mb-2">Admin Login</h1>
            <p className="text-gray-500 text-sm mb-6">Enter your admin email to receive a login OTP</p>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email field */}
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email"
                  name="email"
                  autoFocus
                  placeholder="Admin email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError('')
                  }}
                  className="w-full bg-dark-600 border border-gray-700 rounded-lg pl-11 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 transition-colors"
                />
              </div>

              {/* Error message */}
              {error && <p className="text-red-500 text-sm">{error}</p>}

              {/* Submit button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-500 text-white font-medium py-3 rounded-lg hover:bg-red-600 transition-colors mt-2 disabled:opacity-50"
              >
                {loading ? 'Sending OTP...' : 'Send OTP'}
              </button>
            </form>
          </>
        ) : (
          <>
            {/* Title */}
            <h1 className="text-2xl font-semibold text-white mb-2">Verify Admin Login</h1>
            <p className="text-gray-500 text-sm mb-6">
              A 6-digit OTP has been sent to the authorized admin email. Enter it below to continue.
            </p>

            {/* OTP form */}
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="relative">
                <KeyRound size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  maxLength={6}
                  placeholder="Enter OTP"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, ''))
                    setError('')
                  }}
                  className="w-full bg-dark-600 border border-gray-700 rounded-lg pl-11 pr-4 py-3 text-white placeholder-gray-500 tracking-[0.4em] text-center focus:outline-none focus:border-red-500/50 transition-colors"
                />
              </div>

              {/* Error message */}
              {error && <p className="text-red-500 text-sm">{error}</p>}

              {/* Verify button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-500 text-white font-medium py-3 rounded-lg hover:bg-red-600 transition-colors mt-2 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify & Open Admin Panel'}
              </button>
            </form>

            {/* Resend + Back */}
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={goBack}
                className="flex items-center gap-1 text-gray-400 text-sm hover:text-white transition-colors"
              >
                <ArrowLeft size={14} /> Back
              </button>
              <button
                onClick={handleResend}
                disabled={loading}
                className="text-red-400 text-sm hover:text-red-300 transition-colors disabled:opacity-50"
              >
                Resend OTP
              </button>
            </div>
          </>
        )}

        {/* Info */}
        <p className="text-center text-gray-500 text-sm mt-6">
          Not an admin?{' '}
          <button onClick={() => navigate('/user/login')} className="text-white hover:underline">
            User Login
          </button>
        </p>

        {/* Investor Login Link */}
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-center text-gray-500 text-sm">
            Trading Account Access?{' '}
            <button onClick={() => navigate('/investor/login')} className="text-green-500 hover:text-green-400 hover:underline font-medium">
              Investor Login
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

export default AdminLogin
