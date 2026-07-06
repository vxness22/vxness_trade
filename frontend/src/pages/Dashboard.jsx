import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  LayoutDashboard, 
  User,
  Wallet,
  Users,
  Copy,
  UserCircle,
  HelpCircle,
  FileText,
  LogOut,
  TrendingUp,
  DollarSign,
  Newspaper,
  Calendar,
  RefreshCw,
  Activity,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Bell,
  X,
  TrendingDown,
  Minus
} from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import toast from 'react-hot-toast'
import { API_URL, API_BASE_URL } from '../config/api'
import logoImage from '../assets/logo.png'

const Dashboard = () => {
  const navigate = useNavigate()
  const { isDarkMode, toggleDarkMode } = useTheme()
  const [activeMenu, setActiveMenu] = useState('Dashboard')
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [news, setNews] = useState([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [economicEvents, setEconomicEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [walletBalance, setWalletBalance] = useState(0)
  const [totalTrades, setTotalTrades] = useState(0)
  const [totalCharges, setTotalCharges] = useState(0)
  const [totalPnl, setTotalPnl] = useState(0)
  const [userAccounts, setUserAccounts] = useState([])
  const [challengeModeEnabled, setChallengeModeEnabled] = useState(false)
  const [technicalAnalyses, setTechnicalAnalyses] = useState([])
  const [unreadAnalysisCount, setUnreadAnalysisCount] = useState(0)
  const [showAnalysisModal, setShowAnalysisModal] = useState(false)
  const [selectedAnalysis, setSelectedAnalysis] = useState(null)
  const tradingViewRef = useRef(null)
  const economicCalendarRef = useRef(null)
  const forexHeatmapRef = useRef(null)
  const forexScreenerRef = useRef(null)
  
  // Check if investor mode (read-only)
  const isInvestorMode = sessionStorage.getItem('investorMode') === 'true'
  const investorAccount = isInvestorMode ? JSON.parse(sessionStorage.getItem('investorAccount') || '{}') : null
  
  // Use investor account user or regular logged in user
  const user = isInvestorMode 
    ? (investorAccount?.user || {})
    : JSON.parse(localStorage.getItem('user') || '{}')

  // Handle responsive view switching
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      // Only redirect on initial load if mobile, not on resize
    }
    window.addEventListener('resize', handleResize)
    
    // Initial check - redirect to mobile only on first load
    if (window.innerWidth < 768 && !sessionStorage.getItem('viewChecked')) {
      sessionStorage.setItem('viewChecked', 'true')
      navigate('/mobile')
    }
    
    return () => window.removeEventListener('resize', handleResize)
  }, [navigate])

  // Check auth status on mount
  const checkAuthStatus = async () => {
    // Skip auth check for investor mode - they have their own session
    if (isInvestorMode) {
      return
    }
    
    const token = localStorage.getItem('token')
    if (!token || !user._id) {
      navigate('/user/login')
      return
    }
    
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      
      if (data.forceLogout || res.status === 403) {
        toast.error(data.message || 'Session expired. Please login again.')
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        navigate('/user/login')
        return
      }
    } catch (error) {
      console.error('Auth check error:', error)
    }
  }

  // Fetch wallet balance and user data
  useEffect(() => {
    checkAuthStatus()
    fetchChallengeStatus()
    if (user._id) {
      fetchWalletBalance()
      fetchUserAccounts()
      fetchTechnicalAnalyses()
    }
  }, [user._id])

  // Auto-refresh technical analyses every 10 seconds for real-time updates
  useEffect(() => {
    if (!user._id) return
    
    const interval = setInterval(() => {
      fetchTechnicalAnalyses()
    }, 10000) // 10 seconds
    
    return () => clearInterval(interval)
  }, [user._id])

  // Fetch technical analyses for notifications
  const fetchTechnicalAnalyses = async () => {
    try {
      const res = await fetch(`${API_URL}/technical-analysis/active`)
      const data = await res.json()
      if (data.success) {
        setTechnicalAnalyses(data.analyses)
        // Count unread
        const unread = data.analyses.filter(a => 
          !a.viewedBy?.some(v => v.userId === user._id)
        ).length
        setUnreadAnalysisCount(unread)
      }
    } catch (error) {
      console.error('Error fetching technical analyses:', error)
    }
  }

  const markAnalysisAsViewed = async (analysisId) => {
    try {
      await fetch(`${API_URL}/technical-analysis/mark-viewed/${analysisId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user._id })
      })
      fetchTechnicalAnalyses()
    } catch (error) {
      console.error('Error marking analysis as viewed:', error)
    }
  }

  const openAnalysis = (analysis) => {
    setSelectedAnalysis(analysis)
    setShowAnalysisModal(true)
    if (!analysis.viewedBy?.some(v => v.userId === user._id)) {
      markAnalysisAsViewed(analysis._id)
    }
  }
  
  // Fetch trades after accounts are loaded
  useEffect(() => {
    if (userAccounts.length > 0) {
      fetchTrades()
    }
  }, [userAccounts])

  const fetchChallengeStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/prop/status`)
      const data = await res.json()
      if (data.success) {
        setChallengeModeEnabled(data.enabled)
      }
    } catch (error) {
      console.error('Error fetching challenge status:', error)
    }
  }

  const fetchWalletBalance = async () => {
    try {
      const res = await fetch(`${API_URL}/wallet/${user._id}`)
      const data = await res.json()
      setWalletBalance(data.wallet?.balance || 0)
    } catch (error) {
      console.error('Error fetching wallet:', error)
    }
  }

  const fetchUserAccounts = async () => {
    try {
      const res = await fetch(`${API_URL}/trading-accounts/user/${user._id}`)
      const data = await res.json()
      setUserAccounts(data.accounts || [])
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
  }

  const fetchTrades = async () => {
    try {
      // Fetch trades for all user accounts
      let allTrades = []
      let charges = 0
      let pnl = 0
      
      for (const account of userAccounts) {
        // Fetch closed trades for history
        const historyRes = await fetch(`${API_URL}/trade/history/${account._id}`)
        const historyData = await historyRes.json()
        if (historyData.success && historyData.trades) {
          allTrades = [...allTrades, ...historyData.trades]
          // Calculate charges (commission + swap)
          historyData.trades.forEach(trade => {
            charges += (trade.commission || 0) + (trade.swap || 0)
            pnl += (trade.realizedPnl || 0)
          })
        }
        
        // Fetch open trades
        const openRes = await fetch(`${API_URL}/trade/open/${account._id}`)
        const openData = await openRes.json()
        if (openData.success && openData.trades) {
          allTrades = [...allTrades, ...openData.trades]
        }
      }
      
      setTotalTrades(allTrades.length)
      setTotalCharges(Math.abs(charges))
      setTotalPnl(pnl)
    } catch (error) {
      console.error('Error fetching trades:', error)
    }
  }

  // Fetch crypto news
  useEffect(() => {
    const fetchNews = async () => {
      setNewsLoading(true)
      try {
        // Using CoinGecko's free API for crypto news (no API key needed)
        const response = await fetch('https://api.coingecko.com/api/v3/news')
        if (response.ok) {
          const data = await response.json()
          setNews(data.data?.slice(0, 6) || [])
        } else {
          // Fallback sample news if API fails
          setNews([
            { title: 'Bitcoin Surges Past $100K Milestone', description: 'BTC reaches new all-time high amid institutional buying', updated_at: Date.now(), url: '#' },
            { title: 'Ethereum 2.0 Staking Rewards Increase', description: 'ETH staking yields hit 5.2% APY', updated_at: Date.now() - 3600000, url: '#' },
            { title: 'SEC Approves New Crypto ETFs', description: 'Multiple spot crypto ETFs get regulatory approval', updated_at: Date.now() - 7200000, url: '#' },
            { title: 'DeFi Total Value Locked Hits $200B', description: 'Decentralized finance continues rapid growth', updated_at: Date.now() - 10800000, url: '#' },
            { title: 'Major Bank Launches Crypto Custody', description: 'Traditional finance embraces digital assets', updated_at: Date.now() - 14400000, url: '#' },
            { title: 'NFT Market Shows Recovery Signs', description: 'Trading volume up 40% month-over-month', updated_at: Date.now() - 18000000, url: '#' },
          ])
        }
      } catch (error) {
        // Fallback sample news
        setNews([
          { title: 'Bitcoin Surges Past $100K Milestone', description: 'BTC reaches new all-time high amid institutional buying', updated_at: Date.now(), url: '#' },
          { title: 'Ethereum 2.0 Staking Rewards Increase', description: 'ETH staking yields hit 5.2% APY', updated_at: Date.now() - 3600000, url: '#' },
          { title: 'SEC Approves New Crypto ETFs', description: 'Multiple spot crypto ETFs get regulatory approval', updated_at: Date.now() - 7200000, url: '#' },
          { title: 'DeFi Total Value Locked Hits $200B', description: 'Decentralized finance continues rapid growth', updated_at: Date.now() - 10800000, url: '#' },
          { title: 'Major Bank Launches Crypto Custody', description: 'Traditional finance embraces digital assets', updated_at: Date.now() - 14400000, url: '#' },
          { title: 'NFT Market Shows Recovery Signs', description: 'Trading volume up 40% month-over-month', updated_at: Date.now() - 18000000, url: '#' },
        ])
      }
      setNewsLoading(false)
    }
    fetchNews()
    const interval = setInterval(fetchNews, 300000) // Refresh every 5 minutes
    return () => clearInterval(interval)
  }, [])

  // Economic calendar events
  useEffect(() => {
    setEventsLoading(true)
    // Sample economic events (in production, use a real API like Forex Factory or Trading Economics)
    const sampleEvents = [
      { date: '2026-01-08', time: '08:30', country: 'US', event: 'Non-Farm Payrolls', impact: 'high', forecast: '180K', previous: '227K' },
      { date: '2026-01-08', time: '10:00', country: 'US', event: 'ISM Services PMI', impact: 'high', forecast: '53.5', previous: '52.1' },
      { date: '2026-01-09', time: '08:30', country: 'US', event: 'Initial Jobless Claims', impact: 'medium', forecast: '210K', previous: '211K' },
      { date: '2026-01-09', time: '14:00', country: 'US', event: 'FOMC Meeting Minutes', impact: 'high', forecast: '-', previous: '-' },
      { date: '2026-01-10', time: '08:30', country: 'US', event: 'CPI m/m', impact: 'high', forecast: '0.3%', previous: '0.3%' },
      { date: '2026-01-10', time: '08:30', country: 'US', event: 'Core CPI m/m', impact: 'high', forecast: '0.2%', previous: '0.3%' },
      { date: '2026-01-13', time: '08:30', country: 'US', event: 'PPI m/m', impact: 'medium', forecast: '0.2%', previous: '0.4%' },
      { date: '2026-01-14', time: '08:30', country: 'US', event: 'Retail Sales m/m', impact: 'high', forecast: '0.5%', previous: '0.7%' },
    ]
    setEconomicEvents(sampleEvents)
    setEventsLoading(false)
  }, [])


  const formatTimeAgo = (timestamp) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return 'Just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  const getImpactColor = (impact) => {
    switch (impact) {
      case 'high': return 'bg-red-500'
      case 'medium': return 'bg-orange-500'
      case 'low': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  // Menu items - investor can only access Dashboard and Orders
  const investorAllowedMenus = ['Dashboard', 'Orders']
  
  const menuItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Account', icon: User, path: '/account' },
    { name: 'Wallet', icon: Wallet, path: '/wallet' },
    { name: 'Orders', icon: FileText, path: '/orders' },
    { name: 'IB', icon: Users, path: '/ib' },
    { name: 'Copytrade', icon: Copy, path: '/copytrade' },
    { name: 'Profile', icon: UserCircle, path: '/profile' },
    { name: 'Support', icon: HelpCircle, path: '/support' },
    { name: 'Instructions', icon: FileText, path: '/instructions' },
  ]

  const handleLogout = () => {
    if (isInvestorMode) {
      // Clear investor session data
      sessionStorage.removeItem('investorMode')
      sessionStorage.removeItem('investorAccessType')
      sessionStorage.removeItem('investorAccount')
      sessionStorage.removeItem('investorAccountId')
      sessionStorage.removeItem('investorUserId')
      toast.success('Logged out successfully!')
      navigate('/investor/login')
    } else {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      toast.success('Logged out successfully!')
      navigate('/user/login')
    }
  }

  // Load TradingView widgets - re-render when theme changes
  useEffect(() => {
    const colorTheme = isDarkMode ? "dark" : "light"
    
    // TradingView Timeline Widget (News)
    if (tradingViewRef.current) {
      tradingViewRef.current.innerHTML = ''
      const script = document.createElement('script')
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js'
      script.async = true
      script.innerHTML = JSON.stringify({
        "feedMode": "all_symbols",
        "colorTheme": colorTheme,
        "isTransparent": false,
        "displayMode": "regular",
        "width": "100%",
        "height": "100%",
        "locale": "en"
      })
      tradingViewRef.current.appendChild(script)
    }

    // TradingView Economic Calendar Widget
    if (economicCalendarRef.current) {
      economicCalendarRef.current.innerHTML = ''
      const script = document.createElement('script')
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js'
      script.async = true
      script.innerHTML = JSON.stringify({
        "colorTheme": colorTheme,
        "isTransparent": false,
        "width": "100%",
        "height": "100%",
        "locale": "en",
        "importanceFilter": "0,1",
        "countryFilter": "us,eu,gb,jp,cn"
      })
      economicCalendarRef.current.appendChild(script)
    }

    // TradingView Forex Heatmap Widget
    if (forexHeatmapRef.current) {
      forexHeatmapRef.current.innerHTML = ''
      const script = document.createElement('script')
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-forex-heat-map.js'
      script.async = true
      script.innerHTML = JSON.stringify({
        "width": "100%",
        "height": "100%",
        "currencies": ["EUR", "USD", "JPY", "GBP", "CHF", "AUD", "CAD", "NZD"],
        "isTransparent": false,
        "colorTheme": colorTheme,
        "locale": "en"
      })
      forexHeatmapRef.current.appendChild(script)
    }

    // TradingView Forex Screener Widget
    if (forexScreenerRef.current) {
      forexScreenerRef.current.innerHTML = ''
      const script = document.createElement('script')
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-screener.js'
      script.async = true
      script.innerHTML = JSON.stringify({
        "width": "100%",
        "height": "100%",
        "defaultColumn": "overview",
        "defaultScreen": "general",
        "market": "forex",
        "showToolbar": true,
        "colorTheme": colorTheme,
        "locale": "en",
        "isTransparent": false
      })
      forexScreenerRef.current.appendChild(script)
    }
  }, [isDarkMode])

  return (
    <div className={`h-screen flex overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-dark-900' : 'bg-gray-100'}`}>
      {/* Read-only CSS for investor mode - disable action buttons only, NOT navigation */}
      {isInvestorMode && (
        <style>{`
          .investor-action-disabled button:not(.allow-investor),
          .investor-action-disabled input:not(.allow-investor),
          .investor-action-disabled select:not(.allow-investor),
          .investor-action-disabled textarea:not(.allow-investor),
          .investor-action-disabled [role="button"]:not(.allow-investor) {
            pointer-events: none !important;
            opacity: 0.6 !important;
            cursor: not-allowed !important;
          }
          .investor-action-disabled a:not(.allow-investor) {
            pointer-events: none !important;
          }
        `}</style>
      )}
      
      {/* Collapsible Sidebar - Fixed */}
      <aside 
        className={`${sidebarExpanded ? 'w-48' : 'w-16'} shrink-0 ${isDarkMode ? 'bg-dark-900 border-gray-800' : 'bg-white border-gray-200'} border-r flex flex-col h-screen sticky top-0 transition-all duration-300 ease-in-out`}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
      >
        {/* Logo - Icon only */}
        <div className="p-4 flex items-center justify-center shrink-0">
          <img src={logoImage} alt="vxness" className="h-8 w-auto object-contain" />
        </div>

        {/* Menu */}
        <nav className="flex-1 min-h-0 px-2 overflow-y-auto">
          {menuItems.map((item) => {
            const isDisabledForInvestor = isInvestorMode && !investorAllowedMenus.includes(item.name)
            return (
              <button
                key={item.name}
                onClick={() => !isDisabledForInvestor && navigate(item.path)}
                disabled={isDisabledForInvestor}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors ${
                  isDisabledForInvestor
                    ? 'opacity-80 cursor-not-allowed text-gray-500'
                    : activeMenu === item.name 
                      ? 'bg-accent-green text-black' 
                      : isDarkMode 
                        ? 'text-gray-400 hover:text-white hover:bg-dark-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
                title={!sidebarExpanded ? item.name : ''}
              >
                <item.icon size={18} className="flex-shrink-0" />
                {sidebarExpanded && <span className="text-sm font-medium whitespace-nowrap">{item.name}</span>}
              </button>
            )
          })}
        </nav>

        {/* Theme Toggle & Logout - Fixed at bottom */}
        <div className={`p-2 border-t shrink-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          {/* Theme Toggle */}
          <button 
            onClick={toggleDarkMode}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors ${
              isDarkMode 
                ? 'text-yellow-400 hover:text-yellow-300 hover:bg-dark-700'
                : 'text-blue-600 hover:text-blue-700 hover:bg-gray-100'
            }`}
            title={!sidebarExpanded ? (isDarkMode ? 'Light Mode' : 'Dark Mode') : ''}
          >
            {isDarkMode ? <Sun size={18} className="flex-shrink-0" /> : <Moon size={18} className="flex-shrink-0" />}
            {sidebarExpanded && <span className="text-sm font-medium whitespace-nowrap">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>
          
          <button 
            onClick={handleLogout}
            className={`allow-investor w-full flex items-center gap-3 px-3 py-2.5 transition-colors rounded-lg ${
              isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
            }`}
            title={!sidebarExpanded ? 'Log Out' : ''}
          >
            <LogOut size={18} className="flex-shrink-0" />
            {sidebarExpanded && <span className="text-sm font-medium whitespace-nowrap">Log Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content - Scrollable */}
      <main className={`flex-1 min-h-0 overflow-y-auto ${isInvestorMode ? 'investor-action-disabled' : ''}`}>
        {/* Welcome Banner */}
        <div className={`relative border-b ${isDarkMode ? 'bg-gradient-to-r from-dark-800 via-dark-900 to-dark-800 border-gray-800' : 'bg-gradient-to-r from-gray-100 via-white to-gray-100 border-gray-200'}`}>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-accent-green/20' : 'bg-green-100'}`}>
                <User size={20} className="text-accent-green" />
              </div>
              <div>
                <p className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Welcome back, {user.firstName || 'Trader'}!
                </p>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            {/* Technical Analysis Bell Icon */}
            <div className="relative">
              <button
                onClick={() => setShowAnalysisModal(true)}
                className={`relative p-2 rounded-lg transition-colors ${
                  isDarkMode ? 'hover:bg-dark-700' : 'hover:bg-gray-100'
                }`}
              >
                <Bell size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
                {unreadAnalysisCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
                    {unreadAnalysisCount > 9 ? '9+' : unreadAnalysisCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Simple Header */}
        <header className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          <h1 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Dashboard</h1>
          <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Welcome back!</p>
        </header>

        {/* Dashboard Content */}
        <div className="p-6">
          {/* Top Stats Boxes */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {/* Wallet Box */}
            <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-accent-green/20 rounded-lg flex items-center justify-center">
                  <Wallet size={20} className="text-accent-green" />
                </div>
                <button onClick={() => navigate('/wallet')} className="text-accent-green text-xs font-medium hover:underline">View</button>
              </div>
              <p className={`text-sm mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Wallet Balance</p>
              <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>${walletBalance.toLocaleString()}</p>
            </div>

            {/* Total Trades Box */}
            <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <TrendingUp size={20} className="text-blue-500" />
                </div>
                <span className="text-gray-500 text-xs">{userAccounts.length} accounts</span>
              </div>
              <p className={`text-sm mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Total Trades</p>
              <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{totalTrades.toLocaleString()}</p>
            </div>

            {/* Total Charges Box */}
            <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center">
                  <DollarSign size={20} className="text-orange-500" />
                </div>
                <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Fees & Swap</span>
              </div>
              <p className={`text-sm mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Total Charges</p>
              <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>${totalCharges.toFixed(2)}</p>
            </div>

            {/* Total PnL Box */}
            <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                  <Activity size={20} className="text-purple-500" />
                </div>
                <span className={`text-xs font-medium ${totalPnl >= 0 ? 'text-accent-green' : 'text-red-500'}`}>
                  {totalPnl >= 0 ? '+' : ''}{totalPnl !== 0 ? ((totalPnl / (walletBalance || 1)) * 100).toFixed(1) + '%' : '0%'}
                </span>
              </div>
              <p className={`text-sm mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Total PnL</p>
              <p className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-accent-green' : 'text-red-500'}`}>
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Forex Heatmap */}
          <div className={`rounded-xl p-5 border mb-6 ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center">
                <Activity size={20} className="text-orange-500" />
              </div>
              <div>
                <h2 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Forex Heatmap</h2>
                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Currency strength visualization</p>
              </div>
            </div>
            <div className="h-80 overflow-hidden rounded-lg">
              <div ref={forexHeatmapRef} className="tradingview-widget-container h-full">
                <div className="tradingview-widget-container__widget h-full"></div>
              </div>
            </div>
          </div>

          {/* Forex Screener */}
          <div className={`rounded-xl p-5 border mb-6 ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-cyan-500/20 rounded-lg flex items-center justify-center">
                <TrendingUp size={20} className="text-cyan-500" />
              </div>
              <div>
                <h2 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Forex Screener</h2>
                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Real-time currency pair analysis</p>
              </div>
            </div>
            <div className="h-96 overflow-hidden rounded-lg">
              <div ref={forexScreenerRef} className="tradingview-widget-container h-full">
                <div className="tradingview-widget-container__widget h-full"></div>
              </div>
            </div>
          </div>

          {/* Market News & Economic Calendar - TradingView Widgets */}
          <div className="grid grid-cols-2 gap-6">
            {/* Market News - TradingView Timeline Widget */}
            <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <Newspaper size={20} className="text-blue-500" />
                </div>
                <div>
                  <h2 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Market News</h2>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Real-time updates from TradingView</p>
                </div>
              </div>
              <div className="h-96 overflow-hidden rounded-lg">
                <div ref={tradingViewRef} className="tradingview-widget-container h-full">
                  <div className="tradingview-widget-container__widget h-full"></div>
                </div>
              </div>
            </div>

            {/* Economic Calendar - TradingView Widget */}
            <div className={`rounded-xl p-5 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                  <Calendar size={20} className="text-purple-500" />
                </div>
                <div>
                  <h2 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Economic Calendar</h2>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Real-time events from TradingView</p>
                </div>
              </div>
              <div className="h-96 overflow-hidden rounded-lg">
                <div ref={economicCalendarRef} className="tradingview-widget-container h-full">
                  <div className="tradingview-widget-container__widget h-full"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Technical Analysis Modal */}
      {showAnalysisModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className={`${isDarkMode ? 'bg-dark-700 border-gray-700' : 'bg-white border-gray-200'} rounded-xl w-full max-w-2xl border max-h-[90vh] overflow-hidden flex flex-col`}>
            {/* Modal Header */}
            <div className={`flex items-center justify-between p-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-accent-green/20 rounded-lg flex items-center justify-center">
                  <Bell size={20} className="text-accent-green" />
                </div>
                <div>
                  <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Technical Analysis</h2>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {technicalAnalyses.length} analysis available
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setShowAnalysisModal(false); setSelectedAnalysis(null); }}
                className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-dark-600' : 'hover:bg-gray-100'}`}
              >
                <X size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {selectedAnalysis ? (
                /* Single Analysis View */
                <div>
                  <button
                    onClick={() => setSelectedAnalysis(null)}
                    className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    ← Back to all
                  </button>
                  
                  <img 
                    src={`${API_BASE_URL}${selectedAnalysis.image}`}
                    alt={selectedAnalysis.title}
                    className="w-full rounded-lg mb-4"
                  />
                  
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {selectedAnalysis.title}
                    </h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      selectedAnalysis.analysisType === 'bullish' 
                        ? 'bg-green-500/20 text-green-500'
                        : selectedAnalysis.analysisType === 'bearish'
                        ? 'bg-red-500/20 text-red-500'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {selectedAnalysis.analysisType}
                    </span>
                  </div>
                  
                  {selectedAnalysis.symbol && (
                    <span className={`inline-block px-2 py-1 rounded text-xs mb-3 ${isDarkMode ? 'bg-dark-600 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
                      {selectedAnalysis.symbol}
                    </span>
                  )}
                  
                  <p className={`whitespace-pre-wrap ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {selectedAnalysis.description}
                  </p>
                  
                  <p className={`text-xs mt-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    Posted: {new Date(selectedAnalysis.createdAt).toLocaleString()}
                  </p>
                </div>
              ) : (
                /* Analysis List */
                technicalAnalyses.length === 0 ? (
                  <div className="text-center py-12">
                    <Bell size={48} className={`mx-auto mb-4 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                    <p className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>No technical analysis available</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {technicalAnalyses.map((analysis) => {
                      const isUnread = !analysis.viewedBy?.some(v => v.userId === user._id)
                      return (
                        <div
                          key={analysis._id}
                          onClick={() => openAnalysis(analysis)}
                          className={`flex gap-4 p-3 rounded-lg cursor-pointer transition-colors ${
                            isDarkMode 
                              ? 'hover:bg-dark-600 ' + (isUnread ? 'bg-dark-600/50' : '')
                              : 'hover:bg-gray-50 ' + (isUnread ? 'bg-blue-50' : '')
                          }`}
                        >
                          <img 
                            src={`${API_BASE_URL}${analysis.image}`}
                            alt={analysis.title}
                            className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {isUnread && (
                                <span className="w-2 h-2 bg-accent-green rounded-full flex-shrink-0"></span>
                              )}
                              <h4 className={`font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {analysis.title}
                              </h4>
                              <span className={`px-2 py-0.5 rounded text-xs flex-shrink-0 ${
                                analysis.analysisType === 'bullish' 
                                  ? 'bg-green-500/20 text-green-500'
                                  : analysis.analysisType === 'bearish'
                                  ? 'bg-red-500/20 text-red-500'
                                  : 'bg-gray-500/20 text-gray-400'
                              }`}>
                                {analysis.analysisType === 'bullish' && <TrendingUp size={12} className="inline mr-1" />}
                                {analysis.analysisType === 'bearish' && <TrendingDown size={12} className="inline mr-1" />}
                                {analysis.analysisType === 'neutral' && <Minus size={12} className="inline mr-1" />}
                                {analysis.analysisType}
                              </span>
                            </div>
                            {analysis.symbol && (
                              <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {analysis.symbol}
                              </span>
                            )}
                            <p className={`text-sm line-clamp-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                              {analysis.description}
                            </p>
                            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              {new Date(analysis.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
