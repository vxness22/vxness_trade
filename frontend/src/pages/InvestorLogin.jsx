import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Eye, EyeOff, TrendingUp } from 'lucide-react'
import { API_URL } from '../config/api'

const InvestorLogin = () => {
  const navigate = useNavigate()
  const [accountId, setAccountId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!accountId || !password) {
      toast.error('Please enter Account ID and Password')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/trading-accounts/investor-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, password })
      })
      const data = await res.json()

      if (data.success) {
        // Use sessionStorage for investor (tab-specific, doesn't affect other tabs)
        sessionStorage.setItem('investorAccessType', data.accessType)
        sessionStorage.setItem('investorAccount', JSON.stringify(data.account))
        sessionStorage.setItem('investorMode', 'true')
        sessionStorage.setItem('investorAccountId', data.account._id)
        
        // Store user info to simulate logged in user for dashboard
        sessionStorage.setItem('investorUserId', data.account.user?._id || '')
        
        toast.success('Logged in with Investor (Read-Only) access')
        
        // Navigate to user dashboard (not admin) in read-only mode
        navigate('/dashboard')
      } else {
        toast.error(data.message || 'Invalid credentials')
      }
    } catch (error) {
      toast.error('Login failed. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <TrendingUp size={40} className="text-green-500" />
            <span className="text-3xl font-bold text-white">VXNESS</span>
          </div>
          <h1 className="text-xl text-gray-400">Investor Login</h1>
          <p className="text-gray-500 text-sm mt-2">Access trading account with Account ID & Password</p>
        </div>

        {/* Login Form */}
        <div className="bg-dark-800 rounded-2xl p-8 border border-gray-700">
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-gray-400 text-sm mb-2">Account ID</label>
              <input
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="Enter Account ID (e.g., 12345678)"
                className="w-full bg-dark-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
              />
            </div>

            <div>
              <label className="block text-gray-400 text-sm mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter Master or Investor Password"
                  className="w-full bg-dark-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          <div className="mt-6 p-4 bg-dark-700 rounded-lg">
            <p className="text-gray-400 text-sm">
              <strong className="text-white">Investor Password:</strong> View-only access (read-only)<br/>
              Contact your admin for Account ID and Password
            </p>
          </div>

          <div className="mt-6 text-center">
            <a href="/user/login" className="text-green-500 hover:text-green-400 text-sm">
              ← Back to User Login
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default InvestorLogin
