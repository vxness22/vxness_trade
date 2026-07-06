import { useState, useEffect } from 'react'
import AdminLayout from '../components/AdminLayout'
import { 
  Users,
  TrendingUp,
  Wallet,
  CreditCard,
  RefreshCw,
  Calendar,
  AlertTriangle
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { API_URL } from '../config/api'
import { useTheme } from '../context/ThemeContext'

const AdminOverview = () => {
  const { isDarkMode } = useTheme()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [marginAlerts, setMarginAlerts] = useState({ total: 0, triggered: 0, alerts: [] })
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeToday: 0,
    newThisWeek: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    pendingKYC: 0,
    pendingWithdrawals: 0,
    activeTrades: 0
  })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch users
      const usersResponse = await fetch(`${API_URL}/admin/users`)
      if (usersResponse.ok) {
        const data = await usersResponse.json()
        setUsers(data.users || [])
      }
      
      // Fetch dashboard stats
      const statsResponse = await fetch(`${API_URL}/admin/dashboard-stats`)
      if (statsResponse.ok) {
        const data = await statsResponse.json()
        if (data.success) {
          setStats({
            totalUsers: data.stats.totalUsers || 0,
            activeToday: data.stats.totalUsers || 0,
            newThisWeek: data.stats.newThisWeek || 0,
            totalDeposits: data.stats.totalDeposits || 0,
            totalWithdrawals: data.stats.totalWithdrawals || 0,
            pendingKYC: data.stats.pendingKYC || 0,
            pendingWithdrawals: data.stats.pendingWithdrawals || 0,
            activeTrades: data.stats.activeTrades || 0
          })
        }
      }

      // Fetch margin alerts
      const alertsResponse = await fetch(`${API_URL}/margin-alerts`)
      if (alertsResponse.ok) {
        const data = await alertsResponse.json()
        if (data.success) {
          const triggered = data.alerts?.filter(a => a.triggered)?.length || 0
          setMarginAlerts({
            total: data.alerts?.length || 0,
            triggered: triggered,
            alerts: data.alerts || []
          })
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    }
    setLoading(false)
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const statCards = [
    { 
      title: 'Total Users', 
      value: stats.totalUsers, 
      icon: Users, 
      color: 'blue'
    },
    { 
      title: 'New This Week', 
      value: stats.newThisWeek, 
      icon: TrendingUp, 
      color: 'green'
    },
    { 
      title: 'Total Deposits', 
      value: `$${stats.totalDeposits.toLocaleString()}`, 
      icon: Wallet, 
      color: 'purple'
    },
    { 
      title: 'Total Withdrawals', 
      value: `$${stats.totalWithdrawals.toLocaleString()}`, 
      icon: CreditCard, 
      color: 'orange'
    },
  ]

  return (
    <AdminLayout title="Overview Dashboard" subtitle="Welcome back, Admin">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map((stat, index) => (
          <div key={index} className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 bg-${stat.color}-500/20 rounded-lg flex items-center justify-center`}>
                <stat.icon size={20} className={`text-${stat.color}-500`} />
              </div>
            </div>
            <p className={`text-sm mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>{stat.title}</p>
            <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Margin Alerts Card */}
      {marginAlerts.total > 0 && (
        <div 
          onClick={() => navigate('/admin/margin-alerts')}
          className={`mb-6 rounded-xl p-4 border cursor-pointer transition-all hover:scale-[1.01] ${
            marginAlerts.triggered > 0 
              ? 'bg-red-500/10 border-red-500/50 hover:bg-red-500/20' 
              : 'bg-yellow-500/10 border-yellow-500/50 hover:bg-yellow-500/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                marginAlerts.triggered > 0 ? 'bg-red-500/20' : 'bg-yellow-500/20'
              }`}>
                <AlertTriangle size={24} className={marginAlerts.triggered > 0 ? 'text-red-500' : 'text-yellow-500'} />
              </div>
              <div>
                <h3 className={`font-semibold ${marginAlerts.triggered > 0 ? 'text-red-500' : 'text-yellow-500'}`}>
                  Margin Alerts
                </h3>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {marginAlerts.triggered > 0 
                    ? `${marginAlerts.triggered} alert${marginAlerts.triggered > 1 ? 's' : ''} triggered!` 
                    : `${marginAlerts.total} active alert${marginAlerts.total > 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className={`text-2xl font-bold ${marginAlerts.triggered > 0 ? 'text-red-500' : 'text-yellow-500'}`}>
                  {marginAlerts.triggered > 0 ? marginAlerts.triggered : marginAlerts.total}
                </p>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  {marginAlerts.triggered > 0 ? 'Triggered' : 'Active'}
                </p>
              </div>
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                marginAlerts.triggered > 0 
                  ? 'bg-red-500 text-white' 
                  : 'bg-yellow-500 text-black'
              }`}>
                View All →
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Users */}
        <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Recent Users</h2>
            <button 
              onClick={fetchData}
              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-dark-700' : 'hover:bg-gray-100'}`}
            >
              <RefreshCw size={16} className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'} ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw size={20} className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'} animate-spin`} />
              </div>
            ) : users.length === 0 ? (
              <p className={`text-center py-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>No users registered yet</p>
            ) : (
              users.slice(0, 5).map((user, index) => (
                <div key={index} className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-dark-700' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-accent-green/20 rounded-full flex items-center justify-center">
                      <span className="text-accent-green font-medium">
                        {user.firstName?.charAt(0)?.toUpperCase() || 'U'}
                      </span>
                    </div>
                    <div>
                      <p className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{user.firstName || 'Unknown'}</p>
                      <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>{user.email}</p>
                    </div>
                  </div>
                  <span className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>{formatDate(user.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
          <h2 className={`font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Platform Overview</h2>
          <div className="space-y-4">
            <div className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-dark-700' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <Users size={18} className="text-blue-500" />
                </div>
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>New Users This Week</span>
              </div>
              <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{stats.newThisWeek}</span>
            </div>
            <div className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-dark-700' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                  <Calendar size={18} className="text-yellow-500" />
                </div>
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Pending KYC</span>
              </div>
              <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{stats.pendingKYC}</span>
            </div>
            <div className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-dark-700' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                  <TrendingUp size={18} className="text-green-500" />
                </div>
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Active Trades</span>
              </div>
              <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{stats.activeTrades}</span>
            </div>
            <div className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-dark-700' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                  <Wallet size={18} className="text-purple-500" />
                </div>
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Pending Withdrawals</span>
              </div>
              <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{stats.pendingWithdrawals}</span>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

export default AdminOverview
