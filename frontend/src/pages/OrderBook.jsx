import { useState, useEffect } from 'react'

import toast from 'react-hot-toast'

import { useNavigate } from 'react-router-dom'

import { useInvestorMode, investorReadOnlyCSS } from '../hooks/useInvestorMode'

import priceStreamService from '../services/priceStream'

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

  TrendingDown,

  RefreshCw,

  Download,

  Filter,

  ChevronDown,

  Clock,

  CheckCircle,

  XCircle,

  ArrowLeft,

  Home,

  BookOpen,

  History,

  Activity,

  Sun,

  Moon

} from 'lucide-react'

import { useTheme } from '../context/ThemeContext'

import { API_URL } from '../config/api'
import { confirmToast } from '../utils/dialogs'

import logoImage from '../assets/logo.png'

import { formatPrice } from '../utils/formatPrice'



const OrderBook = () => {

  const navigate = useNavigate()

  const { isDarkMode, toggleDarkMode } = useTheme()

  const { isInvestorMode } = useInvestorMode()

  const [activeMenu, setActiveMenu] = useState('Orders')

  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  const [loading, setLoading] = useState(true)

  const [activeTab, setActiveTab] = useState('positions') // positions, history, pending

  const [selectedAccount, setSelectedAccount] = useState('all')

  const [accounts, setAccounts] = useState([])

  const [openTrades, setOpenTrades] = useState([])

  const [closedTrades, setClosedTrades] = useState([])

  const [pendingOrders, setPendingOrders] = useState([])

  const [livePrices, setLivePrices] = useState({})

  const [historyFilter, setHistoryFilter] = useState('all') // all, today, week, month, year

  const [historySubTab, setHistorySubTab] = useState('all') // all, trades, transactions

  const [dateFrom, setDateFrom] = useState('')

  const [dateTo, setDateTo] = useState('')

  const [currentPage, setCurrentPage] = useState(1)

  const [itemsPerPage, setItemsPerPage] = useState(20)



  // Get user - for investor mode, use investor account's user data

  const investorAccount = isInvestorMode ? JSON.parse(sessionStorage.getItem('investorAccount') || '{}') : null

  const user = isInvestorMode ? (investorAccount?.user || {}) : JSON.parse(localStorage.getItem('user') || '{}')



  // Menu items - investor can only access Dashboard and Orders

  const investorAllowedMenus = ['Dashboard', 'Orders']



  const menuItems = [

    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },

    { name: 'Account', icon: User, path: '/account' },

    { name: 'Wallet', icon: Wallet, path: '/wallet' },

    { name: 'Orders', icon: BookOpen, path: '/orders' },

    { name: 'IB', icon: Users, path: '/ib' },

    { name: 'Copytrade', icon: Copy, path: '/copytrade' },

    { name: 'Profile', icon: UserCircle, path: '/profile' },

    { name: 'Support', icon: HelpCircle, path: '/support' },

  ]



  useEffect(() => {

    const handleResize = () => setIsMobile(window.innerWidth < 768)

    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)

  }, [])



  useEffect(() => {

    if (isInvestorMode && investorAccount?._id) {

      // For investor mode, use the investor account directly

      setAccounts([investorAccount])

    } else if (user._id) {

      fetchAccounts()

    }

  }, [user._id, isInvestorMode])



  useEffect(() => {

    if (accounts.length > 0) {

      fetchAllTrades()

    }

  }, [accounts, selectedAccount])



  // Fetch live prices via WebSocket streaming

  useEffect(() => {

    const unsubscribe = priceStreamService.subscribe('orderBook', (prices, updated, timestamp) => {

      if (!prices || Object.keys(prices).length === 0) return

      

      setLivePrices(prev => {

        const merged = { ...prev }

        Object.entries(prices).forEach(([symbol, price]) => {

          if (price && price.bid) {

            merged[symbol] = price

          }

        })

        return merged

      })

    })

    

    return () => unsubscribe()

  }, [])



  // Fallback: Fetch prices via API if WebSocket prices are empty

  useEffect(() => {

    const fetchPricesForTrades = async () => {

      const symbols = [...new Set(openTrades.map(t => t.symbol))]

      

      const missingSymbols = symbols.filter(s => !livePrices[s]?.bid)

      if (missingSymbols.length === 0) return

      

      try {

        const res = await fetch(`${API_URL}/prices/batch`, {

          method: 'POST',

          headers: { 'Content-Type': 'application/json' },

          body: JSON.stringify({ symbols: missingSymbols })

        })

        const data = await res.json()

        if (data.success && data.prices) {

          setLivePrices(prev => {

            const merged = { ...prev }

            Object.entries(data.prices).forEach(([symbol, price]) => {

              if (price && price.bid) {

                merged[symbol] = price

              }

            })

            return merged

          })

        }

      } catch (e) {

        console.error('Error fetching prices:', e)

      }

    }



    if (openTrades.length > 0) {

      fetchPricesForTrades()

      const interval = setInterval(fetchPricesForTrades, 5000)

      return () => clearInterval(interval)

    }

  }, [openTrades, livePrices])



  const fetchAccounts = async () => {

    try {

      const res = await fetch(`${API_URL}/trading-accounts/user/${user._id}`)

      const data = await res.json()

      setAccounts(data.accounts || [])

    } catch (error) {

      console.error('Error fetching accounts:', error)

    }

  }



  const fetchAllTrades = async () => {

    setLoading(true)

    try {

      const accountsToFetch = selectedAccount === 'all' 

        ? accounts 

        : accounts.filter(a => a._id === selectedAccount)



      let allOpen = []

      let allClosed = []

      let allPending = []



      for (const account of accountsToFetch) {

        // Fetch open trades

        const openRes = await fetch(`${API_URL}/trade/open/${account._id}`)

        const openData = await openRes.json()

        if (openData.success && openData.trades) {

          allOpen = [...allOpen, ...openData.trades.map(t => ({ ...t, accountName: account.accountId }))]

        }



        // Fetch closed trades (history) - UNLIMITED, no auto-delete

        const historyRes = await fetch(`${API_URL}/trade/history/${account._id}`)

        const historyData = await historyRes.json()

        if (historyData.success && historyData.trades) {

          allClosed = [...allClosed, ...historyData.trades.map(t => ({ ...t, accountName: account.accountId }))]

        }



        // Fetch pending orders

        const pendingRes = await fetch(`${API_URL}/trade/pending/${account._id}`)

        const pendingData = await pendingRes.json()

        if (pendingData.success && pendingData.trades) {

          allPending = [...allPending, ...pendingData.trades.map(o => ({ ...o, accountName: account.accountId }))]

        }

      }

      // Fetch transactions (Deposit, Withdrawal, Credit) - only once per user
      try {
        const txnRes = await fetch(`${API_URL}/wallet/transactions/${user._id}`)
        const txnData = await txnRes.json()
        if (txnData.transactions) {
          const transactions = txnData.transactions.map(t => ({
            ...t,
            _id: t._id,
            type: t.type, // DEPOSIT, WITHDRAWAL, CREDIT
            accountName: t.tradingAccountId?.accountId || '-',
            amount: t.type === 'WITHDRAWAL' ? -Math.abs(t.amount) : t.amount,
            createdAt: t.createdAt,
            closedAt: t.createdAt,
            openedAt: t.createdAt
          }))
          allClosed = [...allClosed, ...transactions]
        }
      } catch (e) {
        // Transactions fetch failed, continue without them
      }



      setOpenTrades(allOpen)

      // Sort by closedAt or createdAt
      setClosedTrades(allClosed.sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt)))

      setPendingOrders(allPending)

    } catch (error) {

      console.error('Error fetching trades:', error)

    }

    setLoading(false)

  }



  const calculateFloatingPnl = (trade) => {

    const prices = livePrices[trade.symbol]

    if (!prices || !prices.bid) return 0

    

    const currentPrice = trade.side === 'BUY' ? prices.bid : prices.ask

    if (!currentPrice) return 0

    

    const contractSize = trade.contractSize || getContractSize(trade.symbol)

    const pnl = trade.side === 'BUY'

      ? (currentPrice - trade.openPrice) * trade.quantity * contractSize

      : (trade.openPrice - currentPrice) * trade.quantity * contractSize

    

    return pnl - (trade.commission || 0) - (trade.swap || 0)

  }



  const getContractSize = (symbol) => {

    if (symbol === 'XAUUSD') return 100

    if (symbol === 'XAGUSD') return 5000

    if (['BTCUSD', 'ETHUSD'].includes(symbol)) return 1

    return 100000

  }



  const getTotalPnl = () => {

    return openTrades.reduce((sum, trade) => sum + calculateFloatingPnl(trade), 0)

  }



  const getHistoryTotalPnl = () => {

    return getFilteredHistory().reduce((sum, trade) => sum + (trade.realizedPnl || 0), 0)

  }

  // Calculate summary stats for History tab (like mobile trading app)
  const getHistorySummary = () => {
    const filtered = getFilteredHistory()
    
    // Total Deposits (from transactions - check both cases for type and status)
    const totalDeposit = filtered
      .filter(t => (t.type === 'DEPOSIT' || t.type === 'Deposit') && (t.status === 'APPROVED' || t.status === 'Approved' || t.status === 'Completed'))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0)
    
    // Total Credit
    const totalCredit = filtered
      .filter(t => (t.type === 'CREDIT' || t.type === 'Credit') && (t.status === 'APPROVED' || t.status === 'Approved' || t.status === 'Completed'))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0)
    
    // Total Profit (only from closed trades, not deposits/withdrawals)
    const totalProfit = filtered
      .filter(t => t.status === 'CLOSED' || t.closePrice)
      .reduce((sum, t) => sum + (t.realizedPnl || 0), 0)
    
    // Total Swap
    const totalSwap = filtered
      .filter(t => t.status === 'CLOSED' || t.closePrice)
      .reduce((sum, t) => sum + (t.swap || 0), 0)
    
    // Total Commission
    const totalCommission = filtered
      .filter(t => t.status === 'CLOSED' || t.closePrice)
      .reduce((sum, t) => sum + (t.commission || 0), 0)
    
    // Total Withdrawals
    const totalWithdrawal = filtered
      .filter(t => (t.type === 'WITHDRAWAL' || t.type === 'Withdrawal') && (t.status === 'APPROVED' || t.status === 'Approved' || t.status === 'Completed'))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0)
    
    // Grand Total Balance = Deposits + Credits + Profits - Withdrawals - Commissions + Swaps
    const totalBalance = totalDeposit + totalCredit + totalProfit - totalWithdrawal - totalCommission + totalSwap
    
    return {
      deposit: totalDeposit,
      credit: totalCredit,
      profit: totalProfit,
      swap: totalSwap,
      commission: totalCommission,
      balance: totalBalance
    }
  }



  const getFilteredHistory = () => {

    const now = new Date()

    let filtered = closedTrades



    // Sub-tab filter: trades only show actual trades, transactions show deposits/withdrawals/credits
    if (historySubTab === 'trades') {
      filtered = filtered.filter(t => t.status === 'CLOSED' || t.status === 'STOPPED_OUT' || t.closePrice)
    } else if (historySubTab === 'transactions') {
      filtered = filtered.filter(t => t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL' || t.type === 'CREDIT' || t.type === 'BONUS')
    }



    // Time period filter

    filtered = filtered.filter(trade => {

      if (historyFilter === 'all') return true

      const tradeDate = new Date(trade.closedAt)

      if (historyFilter === 'today') {

        return tradeDate.toDateString() === now.toDateString()

      }

      if (historyFilter === 'week') {

        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

        return tradeDate >= weekAgo

      }

      if (historyFilter === 'month') {

        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

        return tradeDate >= monthAgo

      }

      if (historyFilter === 'year') {

        const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

        return tradeDate >= yearAgo

      }

      return true

    })



    // Custom date range filter

    if (dateFrom) {

      const from = new Date(dateFrom)

      from.setHours(0, 0, 0, 0)

      filtered = filtered.filter(t => new Date(t.closedAt) >= from)

    }

    if (dateTo) {

      const to = new Date(dateTo)

      to.setHours(23, 59, 59, 999)

      filtered = filtered.filter(t => new Date(t.closedAt) <= to)

    }



    return filtered

  }



  const getPaginatedHistory = () => {

    const filtered = getFilteredHistory()

    const startIndex = (currentPage - 1) * itemsPerPage

    return filtered.slice(startIndex, startIndex + itemsPerPage)

  }



  const totalPages = Math.ceil(getFilteredHistory().length / itemsPerPage)



  const downloadCSV = (data, filename) => {

    const headers = ['Date', 'Account', 'Symbol', 'Side', 'Quantity', 'Open Price', 'Close Price', 'P&L', 'Status']

    const rows = data.map(trade => [

      new Date(trade.closedAt || trade.openedAt || trade.createdAt).toLocaleString(),

      trade.accountName || 'N/A',

      trade.symbol,

      trade.side,

      trade.quantity,

      formatPrice(trade.openPrice, trade.symbol),

      trade.closePrice ? formatPrice(trade.closePrice, trade.symbol) : '-',

      (trade.realizedPnl || calculateFloatingPnl(trade)).toFixed(2),

      trade.status

    ])



    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })

    const url = window.URL.createObjectURL(blob)

    const a = document.createElement('a')

    a.href = url

    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`

    a.click()

  }



  const handleCloseTrade = async (trade) => {

    if (!(await confirmToast(`Close ${trade.side} ${trade.quantity} ${trade.symbol} position?`, { confirmText: 'Close' }))) return

    

    try {

      const currentPrice = livePrices[trade.symbol]?.[trade.side === 'BUY' ? 'bid' : 'ask']

      if (!currentPrice) {

        toast.error('Unable to get current price. Please try again.')

        return

      }



      const res = await fetch(`${API_URL}/trade/close`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          tradeId: trade._id,

          closePrice: currentPrice

        })

      })

      const data = await res.json()

      

      if (res.ok && data.success) {

        toast.success(`Trade closed! P&L: $${data.trade?.realizedPnl?.toFixed(2) || '0.00'}`)

        fetchAllTrades()

      } else {

        toast.error(data.message || 'Failed to close trade')

      }

    } catch (error) {

      console.error('Close trade error:', error)

      toast.error('Error closing trade')

    }

  }



  const handleCancelOrder = async (order) => {

    if (!(await confirmToast(`Cancel pending ${order.side} ${order.quantity} ${order.symbol} order?`, { confirmText: 'Cancel order', cancelText: 'Keep' }))) return

    

    try {

      const res = await fetch(`${API_URL}/trade/cancel`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ tradeId: order._id })

      })

      const data = await res.json()

      

      if (res.ok && data.success) {

        toast.success('Order cancelled successfully')

        fetchAllTrades()

      } else {

        toast.error(data.message || 'Failed to cancel order')

      }

    } catch (error) {

      console.error('Cancel order error:', error)

      toast.error('Error cancelling order')

    }

  }



  const handleLogout = () => {

    localStorage.removeItem('token')

    localStorage.removeItem('user')

    toast.success('Logged out successfully!')

    navigate('/user/login')

  }



  const formatDate = (dateString) => {

    if (!dateString) return '-'

    return new Date(dateString).toLocaleDateString('en-US', {

      month: 'short',

      day: 'numeric',

      hour: '2-digit',

      minute: '2-digit'

    })

  }



  return (

    <div className={`min-h-screen flex transition-colors duration-300 ${isDarkMode ? 'bg-dark-900' : 'bg-gray-100'}`}>

      {/* Investor Read-Only CSS */}

      {isInvestorMode && <style>{investorReadOnlyCSS}</style>}

      {/* Mobile Header */}

      {isMobile && (

        <header className={`fixed top-0 left-0 right-0 z-40 px-4 py-3 flex items-center gap-4 ${isDarkMode ? 'bg-dark-800 border-b border-gray-800' : 'bg-white border-b border-gray-200'}`}>

          <button onClick={() => navigate('/mobile')} className={`p-2 -ml-2 rounded-lg ${isDarkMode ? 'hover:bg-dark-700' : 'hover:bg-gray-100'}`}>

            <ArrowLeft size={22} className={isDarkMode ? 'text-white' : 'text-gray-900'} />

          </button>

          <h1 className={`font-semibold text-lg flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Order Book</h1>

          <button 

            onClick={toggleDarkMode}

            className={`p-2 rounded-lg ${isDarkMode ? 'text-yellow-400 hover:bg-dark-700' : 'text-blue-500 hover:bg-gray-100'}`}

          >

            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}

          </button>

          <button onClick={() => navigate('/mobile')} className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-dark-700' : 'hover:bg-gray-100'}`}>

            <Home size={20} className="text-gray-400" />

          </button>

        </header>

      )}



      {/* Sidebar - Desktop Only */}

      {!isMobile && (

        <aside 

          className={`${sidebarExpanded ? 'w-48' : 'w-16'} ${isDarkMode ? 'bg-dark-900 border-gray-800' : 'bg-white border-gray-200'} border-r flex flex-col transition-all duration-300`}

          onMouseEnter={() => setSidebarExpanded(true)}

          onMouseLeave={() => setSidebarExpanded(false)}

        >

          <div className="p-4 flex items-center justify-center">

            <img src={logoImage} alt="vxness" className="h-8 w-auto object-contain" />

          </div>

          <nav className="flex-1 px-2">

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

                        : isDarkMode ? 'text-gray-400 hover:text-white hover:bg-dark-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'

                  }`}

                >

                  <item.icon size={18} className="flex-shrink-0" />

                  {sidebarExpanded && <span className="text-sm font-medium">{item.name}</span>}

                </button>

              )

            })}

          </nav>

          <div className={`p-2 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

            <button 

              onClick={toggleDarkMode}

              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors ${isDarkMode ? 'text-yellow-400 hover:bg-dark-700' : 'text-blue-500 hover:bg-gray-100'}`}

            >

              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}

              {sidebarExpanded && <span className="text-sm font-medium">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>}

            </button>

            <button onClick={handleLogout} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}>

              <LogOut size={18} />

              {sidebarExpanded && <span className="text-sm">Log Out</span>}

            </button>

          </div>

        </aside>

      )}



      {/* Main Content */}

      <main className={`flex-1 overflow-auto ${isMobile ? 'pt-14' : ''} ${isInvestorMode ? 'investor-action-disabled' : ''}`}>

        {!isMobile && (

          <header className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

            <div>

              <h1 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Order Book</h1>

              <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>View all your positions, history & pending orders</p>

            </div>

          </header>

        )}



        <div className={`${isMobile ? 'p-4' : 'p-6'}`}>

          {/* Account Filter & Stats */}

          <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-4 gap-4'} mb-4`}>

            {/* Account Selector */}

            <div className={`rounded-xl p-4 border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200'}`}>

              <label className={`block text-xs mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Select Account</label>

              <select

                value={selectedAccount}

                onChange={(e) => setSelectedAccount(e.target.value)}

                className={`w-full rounded-lg px-3 py-2 text-sm ${isDarkMode ? 'bg-dark-700 border-gray-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'} border`}

              >

                <option value="all">All Accounts</option>

                {accounts.map(acc => (

                  <option key={acc._id} value={acc._id}>{acc.accountId}</option>

                ))}

              </select>

            </div>



            {/* Open Positions Count */}

            <div className={`${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'} rounded-xl p-4 border`}>

              <p className={`text-xs mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Open Positions</p>

              <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{openTrades.length}</p>

            </div>



            {/* Floating P&L */}

            <div className={`${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'} rounded-xl p-4 border`}>

              <p className={`text-xs mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Floating P&L</p>

              <p className={`text-2xl font-bold ${getTotalPnl() >= 0 ? 'text-green-500' : 'text-red-500'}`}>

                {getTotalPnl() >= 0 ? '+' : ''}${getTotalPnl().toFixed(2)}

              </p>

            </div>



            {/* Total Closed P&L */}

            <div className={`${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'} rounded-xl p-4 border`}>

              <p className={`text-xs mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Realized P&L</p>

              <p className={`text-2xl font-bold ${getHistoryTotalPnl() >= 0 ? 'text-green-500' : 'text-red-500'}`}>

                {getHistoryTotalPnl() >= 0 ? '+' : ''}${getHistoryTotalPnl().toFixed(2)}

              </p>

            </div>

          </div>



          {/* Tabs */}

          <div className={`${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200 shadow-sm'} rounded-xl border overflow-hidden`}>

            <div className={`flex border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

              <button

                onClick={() => setActiveTab('positions')}

                className={`allow-investor flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 ${

                  activeTab === 'positions' ? 'bg-accent-green/10 text-accent-green border-b-2 border-accent-green' : isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'

                }`}

              >

                <Activity size={16} /> Positions ({openTrades.length})

              </button>

              <button

                onClick={() => setActiveTab('history')}

                className={`allow-investor flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 ${

                  activeTab === 'history' ? 'bg-accent-green/10 text-accent-green border-b-2 border-accent-green' : isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'

                }`}

              >

                <History size={16} /> History ({closedTrades.length})

              </button>

              <button

                onClick={() => setActiveTab('pending')}

                className={`allow-investor flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 ${

                  activeTab === 'pending' ? 'bg-accent-green/10 text-accent-green border-b-2 border-accent-green' : isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'

                }`}

              >

                <Clock size={16} /> Pending ({pendingOrders.length})

              </button>

            </div>



            {/* Tab Actions */}

            <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

              <button

                onClick={fetchAllTrades}

                className={`flex items-center gap-2 text-sm ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}

              >

                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh

              </button>

              <button

                onClick={() => downloadCSV(activeTab === 'positions' ? openTrades : getFilteredHistory(), activeTab)}

                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isDarkMode ? 'bg-dark-700 hover:bg-dark-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'}`}

              >

                <Download size={14} /> Download CSV

              </button>

            </div>



            {/* Content */}

            {loading ? (

              <div className="flex items-center justify-center py-12">

                <RefreshCw size={24} className="text-gray-500 animate-spin" />

              </div>

            ) : (

              <div className="overflow-x-auto">

                {/* Positions Tab */}

                {activeTab === 'positions' && (

                  openTrades.length === 0 ? (

                    <div className="text-center py-12">

                      <Activity size={48} className="text-gray-600 mx-auto mb-3" />

                      <p className="text-gray-500">No open positions</p>

                    </div>

                  ) : (

                    <table className="w-full">

                      <thead>

                        <tr className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Account</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Symbol</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Side</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Qty</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Open Price</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Open Time</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Current</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Charges</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">P&L</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">SL/TP</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Action</th>

                        </tr>

                      </thead>

                      <tbody>

                        {openTrades.map((trade) => {

                          const pnl = calculateFloatingPnl(trade)

                          const currentPrice = livePrices[trade.symbol]?.[trade.side === 'BUY' ? 'bid' : 'ask']

                          return (

                            <tr key={trade._id} className={`border-b ${isDarkMode ? 'border-gray-800 hover:bg-dark-700/50' : 'border-gray-200 hover:bg-gray-50'}`}>

                              <td className="py-3 px-4 text-gray-400 text-sm">{trade.accountName}</td>

                              <td className={`py-3 px-4 font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{trade.symbol}</td>

                              <td className="py-3 px-4">

                                <span className={`flex items-center gap-1 ${trade.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>

                                  {trade.side === 'BUY' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}

                                  {trade.side}

                                </span>

                              </td>

                              <td className={`py-3 px-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{trade.quantity}</td>

                              <td className="py-3 px-4 text-gray-400">{formatPrice(trade.openPrice, trade.symbol)}</td>

                              <td className="py-3 px-4 text-gray-400 text-xs">
                                {trade.openedAt || trade.createdAt ? (
                                  <>
                                    <div>{new Date(trade.openedAt || trade.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                                    <div>{new Date(trade.openedAt || trade.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                                  </>
                                ) : '-'}
                              </td>

                              <td className={`py-3 px-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatPrice(currentPrice, trade.symbol)}</td>

                              <td className="py-3 px-4 text-red-500 text-sm">${(trade.commission || 0).toFixed(2)}</td>

                              <td className={`py-3 px-4 font-medium ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>

                                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}

                              </td>

                              <td className="py-3 px-4 text-gray-400 text-xs">

                                <div>SL: {trade.stopLoss || '-'}</div>

                                <div>TP: {trade.takeProfit || '-'}</div>

                              </td>

                              <td className="py-3 px-4">

                                <button

                                  onClick={() => handleCloseTrade(trade)}

                                  className="bg-red-500/20 text-red-500 hover:bg-red-500/30 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"

                                >

                                  Close

                                </button>

                              </td>

                            </tr>

                          )

                        })}

                      </tbody>

                    </table>

                  )

                )}



                {/* History Tab */}

                {activeTab === 'history' && (

                  <>

                    {/* History Filter Bar */}

                    <div className={`p-3 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

                      {/* Mobile: Simplified filters */}
                      {isMobile ? (
                        <div className="space-y-2">
                          {/* Row 1: Sub-tabs */}
                          <div className="flex gap-1">
                            {[
                              { key: 'all', label: 'All' },
                              { key: 'trades', label: 'Trades' },
                              { key: 'transactions', label: 'Trans.' }
                            ].map(tab => (
                              <button
                                key={tab.key}
                                onClick={() => { setHistorySubTab(tab.key); setCurrentPage(1) }}
                                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                  historySubTab === tab.key 
                                    ? 'bg-accent-green text-black' 
                                    : isDarkMode ? 'bg-dark-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                          {/* Row 2: Time filters */}
                          <div className="flex gap-1 overflow-x-auto">
                            {[
                              { key: 'all', label: 'All' },
                              { key: 'today', label: 'Today' },
                              { key: 'week', label: 'Week' },
                              { key: 'month', label: 'Month' }
                            ].map(filter => (
                              <button
                                key={filter.key}
                                onClick={() => { setHistoryFilter(filter.key); setCurrentPage(1) }}
                                className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                                  historyFilter === filter.key 
                                    ? 'bg-accent-green text-black' 
                                    : isDarkMode ? 'bg-dark-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                {filter.label}
                              </button>
                            ))}
                          </div>
                          {/* Row 3: Summary */}
                          <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            {getFilteredHistory().length} Items | P&L: <span className={`font-medium ${getHistoryTotalPnl() >= 0 ? 'text-green-500' : 'text-red-500'}`}>${getHistoryTotalPnl().toFixed(2)}</span>
                          </div>
                        </div>
                      ) : (
                        /* Desktop: Full filters */
                        <div className="flex flex-wrap items-center gap-2">

                          {/* Sub-tabs */}

                          {[

                            { key: 'all', label: 'All' },

                            { key: 'trades', label: 'Trades' },

                            { key: 'transactions', label: 'Transactions' }

                          ].map(tab => (

                            <button

                              key={tab.key}

                              onClick={() => { setHistorySubTab(tab.key); setCurrentPage(1) }}

                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${

                                historySubTab === tab.key 

                                  ? 'bg-accent-green text-black' 

                                  : isDarkMode ? 'bg-dark-700 text-gray-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'

                              }`}

                            >

                              {tab.label}

                            </button>

                          ))}



                          {/* Separator */}

                          <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`} />



                          {/* Time period filters */}

                          {[

                            { key: 'all', label: 'All' },

                            { key: 'today', label: 'Today' },

                            { key: 'week', label: 'This Week' },

                            { key: 'month', label: 'This Month' },

                            { key: 'year', label: 'This Year' }

                          ].map(filter => (

                            <button

                              key={filter.key}

                              onClick={() => { setHistoryFilter(filter.key); setCurrentPage(1) }}

                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${

                                historyFilter === filter.key 

                                  ? 'bg-accent-green text-black' 

                                : isDarkMode ? 'bg-dark-700 text-gray-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'

                            }`}

                          >

                            {filter.label}

                          </button>

                        ))}



                        {/* Date range picker */}

                        <div className="flex items-center gap-1.5 ml-1">

                          <input

                            type="date"

                            value={dateFrom}

                            onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1) }}

                            placeholder="dd/mm/yyyy"

                            className={`px-2 py-1.5 rounded-lg text-xs border ${isDarkMode ? 'bg-dark-700 border-gray-700 text-gray-300' : 'bg-gray-50 border-gray-300 text-gray-700'}`}

                          />

                          <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>to</span>

                          <input

                            type="date"

                            value={dateTo}

                            onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1) }}

                            placeholder="dd/mm/yyyy"

                            className={`px-2 py-1.5 rounded-lg text-xs border ${isDarkMode ? 'bg-dark-700 border-gray-700 text-gray-300' : 'bg-gray-50 border-gray-300 text-gray-700'}`}

                          />

                        </div>

                          {/* Items count + P&L */}
                          <span className={`ml-auto text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            {getFilteredHistory().length} Items | P&L: <span className={`font-medium ${getHistoryTotalPnl() >= 0 ? 'text-green-500' : 'text-red-500'}`}>${getHistoryTotalPnl().toFixed(2)}</span>
                          </span>

                        </div>
                      )}

                    </div>



                    {getFilteredHistory().length === 0 ? (

                      <div className="text-center py-12">

                        <History size={48} className="text-gray-600 mx-auto mb-3" />

                        <p className="text-gray-500">No trade history for this period</p>

                      </div>

                    ) : (

                      <>
                        {/* Mobile Card View */}
                        {isMobile ? (
                          <div className="divide-y divide-gray-800">
                            {getPaginatedHistory().map((trade) => (
                              <div key={trade._id} className={`p-4 ${isDarkMode ? 'hover:bg-dark-700/50' : 'hover:bg-gray-50'}`}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                      trade.type === 'DEPOSIT' ? 'bg-green-500/20 text-green-500' :
                                      trade.type === 'WITHDRAWAL' ? 'bg-orange-500/20 text-orange-500' :
                                      trade.type === 'CREDIT' ? 'bg-purple-500/20 text-purple-500' :
                                      'bg-blue-500/20 text-blue-500'
                                    }`}>
                                      {trade.type || 'Trade'}
                                    </span>
                                    <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{trade.symbol || '-'}</span>
                                    {trade.side && (
                                      <span className={`flex items-center gap-0.5 text-xs ${trade.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                                        {trade.side === 'BUY' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                        {trade.side}
                                      </span>
                                    )}
                                  </div>
                                  <span className={`font-semibold ${(trade.realizedPnl || trade.amount || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {(trade.realizedPnl || trade.amount || 0) >= 0 ? '+' : ''}${(trade.realizedPnl || trade.amount || 0).toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                  <span>{trade.quantity ? `${trade.quantity} lots` : ''} {trade.accountName ? `• ${trade.accountName}` : ''}</span>
                                  <span>
                                    {trade.closedAt 
                                      ? new Date(trade.closedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                                      : trade.openedAt || trade.createdAt 
                                        ? new Date(trade.openedAt || trade.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                                        : '-'
                                    }
                                  </span>
                                </div>
                                {trade.openPrice && (
                                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                                    <span>Open: {formatPrice(trade.openPrice, trade.symbol)}</span>
                                    {trade.closePrice && <span>Close: {formatPrice(trade.closePrice, trade.symbol)}</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          /* Desktop Table View */
                          <table className="w-full">

                            <thead>

                              <tr className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Type</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Account</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Symbol</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Side</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Qty</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Open Price</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Charges</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Open Time</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Close Price</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Close Time</th>

                                <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">P&L</th>

                              </tr>

                            </thead>

                            <tbody>

                              {getPaginatedHistory().map((trade) => (

                                <tr key={trade._id} className={`border-b ${isDarkMode ? 'border-gray-800 hover:bg-dark-700/50' : 'border-gray-200 hover:bg-gray-50'}`}>

                                  <td className="py-3 px-4">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      trade.type === 'DEPOSIT' ? 'bg-green-500/20 text-green-500' :
                                      trade.type === 'WITHDRAWAL' ? 'bg-orange-500/20 text-orange-500' :
                                      trade.type === 'CREDIT' ? 'bg-purple-500/20 text-purple-500' :
                                      'bg-blue-500/20 text-blue-500'
                                    }`}>
                                      {trade.type || 'Trade'}
                                    </span>
                                  </td>

                                  <td className="py-3 px-4 text-gray-400 text-sm">{trade.accountName}</td>

                                  <td className={`py-3 px-4 font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{trade.symbol || '-'}</td>

                                  <td className="py-3 px-4">
                                    {trade.side ? (
                                      <span className={`flex items-center gap-1 ${trade.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                                        {trade.side === 'BUY' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                        {trade.side}
                                      </span>
                                    ) : '-'}
                                  </td>

                                  <td className={`py-3 px-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{trade.quantity || '-'}</td>

                                  <td className="py-3 px-4 text-gray-400">{formatPrice(trade.openPrice, trade.symbol)}</td>

                                  <td className="py-3 px-4 text-red-500 text-sm">${(trade.commission || 0).toFixed(2)}</td>

                                  <td className="py-3 px-4 text-gray-400 text-xs">
                                    {trade.openedAt || trade.createdAt ? (
                                      <>
                                        <div>{new Date(trade.openedAt || trade.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                                        <div>{new Date(trade.openedAt || trade.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                                      </>
                                    ) : '-'}
                                  </td>

                                  <td className="py-3 px-4 text-gray-400">{formatPrice(trade.closePrice, trade.symbol)}</td>

                                  <td className="py-3 px-4 text-gray-400 text-xs">
                                    {trade.closedAt ? (
                                      <>
                                        <div>{new Date(trade.closedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                                        <div>{new Date(trade.closedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                                      </>
                                    ) : '-'}
                                  </td>

                                  <td className={`py-3 px-4 font-medium ${(trade.realizedPnl || trade.amount || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {(trade.realizedPnl || trade.amount || 0) >= 0 ? '+' : ''}${(trade.realizedPnl || trade.amount || 0).toFixed(2)}
                                  </td>

                                </tr>

                              ))}

                            </tbody>

                          </table>
                        )}



                        {/* Pagination */}

                        {getFilteredHistory().length > 0 && (

                          <div className={`flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

                            {/* Left: Items per page & count */}
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Show:</span>
                                <select
                                  value={itemsPerPage}
                                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1) }}
                                  className={`px-2 py-1 rounded text-sm ${isDarkMode ? 'bg-dark-700 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'} border`}
                                >
                                  <option value={10}>10</option>
                                  <option value={20}>20</option>
                                  <option value={50}>50</option>
                                  <option value={100}>100</option>
                                </select>
                              </div>
                              <span className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                {((currentPage - 1) * itemsPerPage) + 1}-{Math.min(currentPage * itemsPerPage, getFilteredHistory().length)} of {getFilteredHistory().length}
                              </span>
                            </div>

                            {/* Right: Page navigation */}
                            {totalPages > 1 && (
                              <div className="flex items-center gap-1">
                                {/* First page */}
                                <button
                                  onClick={() => setCurrentPage(1)}
                                  disabled={currentPage === 1}
                                  className={`px-2 py-1 rounded text-sm ${isDarkMode ? 'bg-dark-700 hover:bg-dark-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                  «
                                </button>
                                
                                {/* Previous */}
                                <button
                                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                  disabled={currentPage === 1}
                                  className={`px-2 py-1 rounded text-sm ${isDarkMode ? 'bg-dark-700 hover:bg-dark-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                  ‹
                                </button>

                                {/* Page numbers */}
                                {(() => {
                                  const pages = []
                                  const maxVisible = 5
                                  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2))
                                  let end = Math.min(totalPages, start + maxVisible - 1)
                                  if (end - start + 1 < maxVisible) {
                                    start = Math.max(1, end - maxVisible + 1)
                                  }
                                  
                                  if (start > 1) {
                                    pages.push(
                                      <button key={1} onClick={() => setCurrentPage(1)} className={`px-3 py-1 rounded text-sm ${isDarkMode ? 'bg-dark-700 hover:bg-dark-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'}`}>1</button>
                                    )
                                    if (start > 2) pages.push(<span key="dots1" className="px-1 text-gray-500">...</span>)
                                  }
                                  
                                  for (let i = start; i <= end; i++) {
                                    pages.push(
                                      <button
                                        key={i}
                                        onClick={() => setCurrentPage(i)}
                                        className={`px-3 py-1 rounded text-sm ${
                                          currentPage === i 
                                            ? 'bg-accent-green text-black font-medium' 
                                            : isDarkMode ? 'bg-dark-700 hover:bg-dark-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                                        }`}
                                      >
                                        {i}
                                      </button>
                                    )
                                  }
                                  
                                  if (end < totalPages) {
                                    if (end < totalPages - 1) pages.push(<span key="dots2" className="px-1 text-gray-500">...</span>)
                                    pages.push(
                                      <button key={totalPages} onClick={() => setCurrentPage(totalPages)} className={`px-3 py-1 rounded text-sm ${isDarkMode ? 'bg-dark-700 hover:bg-dark-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'}`}>{totalPages}</button>
                                    )
                                  }
                                  
                                  return pages
                                })()}

                                {/* Next */}
                                <button
                                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                  disabled={currentPage === totalPages}
                                  className={`px-2 py-1 rounded text-sm ${isDarkMode ? 'bg-dark-700 hover:bg-dark-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                  ›
                                </button>

                                {/* Last page */}
                                <button
                                  onClick={() => setCurrentPage(totalPages)}
                                  disabled={currentPage === totalPages}
                                  className={`px-2 py-1 rounded text-sm ${isDarkMode ? 'bg-dark-700 hover:bg-dark-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                  »
                                </button>
                              </div>
                            )}

                          </div>

                        )}

                      </>

                    )}

                    {/* Summary Section - Like Mobile Trading App */}
                    {getFilteredHistory().length > 0 && (
                      <div className={`border-t ${isDarkMode ? 'border-gray-700 bg-dark-800' : 'border-gray-200 bg-gray-50'} p-4`}>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 text-sm">Deposit</span>
                            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {getHistorySummary().deposit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 text-sm">Credit</span>
                            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {getHistorySummary().credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 text-sm">Profit</span>
                            <span className={`font-medium ${getHistorySummary().profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {getHistorySummary().profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 text-sm">Swap</span>
                            <span className={`font-medium ${getHistorySummary().swap >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {getHistorySummary().swap.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 text-sm">Commission</span>
                            <span className={`font-medium text-red-500`}>
                              -{getHistorySummary().commission.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 text-sm">Balance</span>
                            <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {getHistorySummary().balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                  </>

                )}



                {/* Pending Tab */}

                {activeTab === 'pending' && (

                  pendingOrders.length === 0 ? (

                    <div className="text-center py-12">

                      <Clock size={48} className="text-gray-600 mx-auto mb-3" />

                      <p className="text-gray-500">No pending orders</p>

                    </div>

                  ) : (

                    <table className="w-full">

                      <thead>

                        <tr className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Account</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Symbol</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Type</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Side</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Qty</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Price</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Status</th>

                          <th className="text-left text-gray-500 text-xs font-medium py-3 px-4">Action</th>

                        </tr>

                      </thead>

                      <tbody>

                        {pendingOrders.map((order) => (

                          <tr key={order._id} className={`border-b ${isDarkMode ? 'border-gray-800 hover:bg-dark-700/50' : 'border-gray-200 hover:bg-gray-50'}`}>

                            <td className="py-3 px-4 text-gray-400 text-sm">{order.accountName}</td>

                            <td className={`py-3 px-4 font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{order.symbol}</td>

                            <td className="py-3 px-4 text-yellow-500 text-sm">{order.orderType}</td>

                            <td className="py-3 px-4">

                              <span className={`flex items-center gap-1 ${order.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>

                                {order.side === 'BUY' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}

                                {order.side}

                              </span>

                            </td>

                            <td className={`py-3 px-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{order.quantity}</td>

                            <td className="py-3 px-4 text-gray-400">{order.limitPrice ? formatPrice(order.limitPrice, order.symbol) : formatPrice(order.stopPrice, order.symbol)}</td>

                            <td className="py-3 px-4">

                              <span className="px-2 py-1 bg-yellow-500/20 text-yellow-500 rounded text-xs">

                                {order.status}

                              </span>

                            </td>

                            <td className="py-3 px-4">

                              <button

                                onClick={() => handleCancelOrder(order)}

                                className="bg-red-500/20 text-red-500 hover:bg-red-500/30 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"

                              >

                                Cancel

                              </button>

                            </td>

                          </tr>

                        ))}

                      </tbody>

                    </table>

                  )

                )}

              </div>

            )}

          </div>

        </div>

      </main>

    </div>

  )

}



export default OrderBook

