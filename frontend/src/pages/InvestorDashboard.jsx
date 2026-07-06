import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  BarChart3, 
  Clock, 
  LogOut,
  Eye,
  Lock
} from 'lucide-react'
import { API_URL } from '../config/api'
import priceStreamService from '../services/priceStream'
import { formatPrice } from '../utils/formatPrice'

const InvestorDashboard = () => {
  const { accountId } = useParams()
  const navigate = useNavigate()
  const [account, setAccount] = useState(null)
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [accessType, setAccessType] = useState('investor')
  const [livePrices, setLivePrices] = useState({})

  useEffect(() => {
    const storedAccessType = localStorage.getItem('investorAccessType')
    const storedAccount = localStorage.getItem('investorAccount')
    
    if (!storedAccount) {
      navigate('/investor/login')
      return
    }

    setAccessType(storedAccessType || 'investor')
    setAccount(JSON.parse(storedAccount))
    fetchAccountData()
    fetchTrades()
  }, [accountId, navigate])

  // Subscribe to live prices
  useEffect(() => {
    const unsubscribe = priceStreamService.subscribe('investorDashboard', (prices) => {
      if (prices && Object.keys(prices).length > 0) {
        setLivePrices(prices)
      }
    })
    return () => unsubscribe()
  }, [])

  const fetchAccountData = async () => {
    try {
      const res = await fetch(`${API_URL}/trading-accounts/${accountId}`)
      const data = await res.json()
      if (data.account) {
        setAccount(prev => ({ ...prev, ...data.account }))
      }
    } catch (error) {
      console.error('Error fetching account:', error)
    }
  }

  const fetchTrades = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/trade/account/${accountId}`)
      const data = await res.json()
      if (data.trades) {
        setTrades(data.trades)
      }
    } catch (error) {
      console.error('Error fetching trades:', error)
    }
    setLoading(false)
  }

  const handleLogout = () => {
    localStorage.removeItem('investorAccessType')
    localStorage.removeItem('investorAccount')
    navigate('/investor/login')
    toast.success('Logged out successfully')
  }

  // Calculate floating PnL
  const calculateFloatingPnl = (trade) => {
    if (trade.status !== 'OPEN') return trade.realizedPnl || 0
    const prices = livePrices[trade.symbol]
    if (!prices || !prices.bid) return 0
    
    const currentPrice = trade.side === 'BUY' ? prices.bid : prices.ask
    const contractSize = trade.contractSize || 1
    let pnl = 0
    
    if (trade.side === 'BUY') {
      pnl = (currentPrice - trade.openPrice) * trade.quantity * contractSize
    } else {
      pnl = (trade.openPrice - currentPrice) * trade.quantity * contractSize
    }
    
    return pnl - (trade.commission || 0) - (trade.swap || 0)
  }

  const openTrades = trades.filter(t => t.status === 'OPEN')
  const closedTrades = trades.filter(t => t.status === 'CLOSED')
  const totalFloatingPnl = openTrades.reduce((sum, t) => sum + calculateFloatingPnl(t), 0)
  const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0)
  const equity = (account?.balance || 0) + totalFloatingPnl

  if (!account) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-900">
      {/* Header */}
      <header className="bg-dark-800 border-b border-gray-700 px-4 md:px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <TrendingUp size={28} className="text-green-500" />
            <div>
              <h1 className="text-lg md:text-xl font-bold text-white">Account: {account.accountId}</h1>
              <p className="text-gray-400 text-xs md:text-sm">{account.user?.firstName} {account.user?.lastName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {/* Access Type Badge */}
            <div className={`flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm ${
              accessType === 'investor' 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
              {accessType === 'investor' ? <Eye size={16} /> : <Lock size={16} />}
              <span className="font-medium">
                {accessType === 'investor' ? 'Read-Only' : 'Full Access'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 md:gap-2 px-3 md:px-4 py-1.5 md:py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-gray-400 hover:text-white transition-colors text-sm"
            >
              <LogOut size={16} />
              <span className="hidden md:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 md:p-6">
        {/* Read-Only Notice for Investor */}
        {accessType === 'investor' && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-yellow-500 flex items-center gap-2">
              <Eye size={20} />
              <span><strong>Read-Only Mode:</strong> You are viewing this account with investor access. Trading is disabled.</span>
            </p>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-dark-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <Wallet className="text-blue-500" size={24} />
              <span className="text-gray-400">Balance</span>
            </div>
            <p className="text-2xl font-bold text-white">${(account.balance || 0).toFixed(2)}</p>
          </div>

          <div className="bg-dark-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 className="text-purple-500" size={24} />
              <span className="text-gray-400">Equity</span>
            </div>
            <p className="text-2xl font-bold text-white">${equity.toFixed(2)}</p>
          </div>

          <div className="bg-dark-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp className="text-green-500" size={24} />
              <span className="text-gray-400">Floating P&L</span>
            </div>
            <p className={`text-2xl font-bold ${totalFloatingPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalFloatingPnl >= 0 ? '+' : ''}${totalFloatingPnl.toFixed(2)}
            </p>
          </div>

          <div className="bg-dark-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="text-orange-500" size={24} />
              <span className="text-gray-400">Realized P&L</span>
            </div>
            <p className={`text-2xl font-bold ${totalRealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalRealizedPnl >= 0 ? '+' : ''}${totalRealizedPnl.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Open Trades */}
        <div className="bg-dark-800 rounded-xl border border-gray-700 mb-8">
          <div className="p-4 md:p-6 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">Open Trades ({openTrades.length})</h2>
          </div>
          
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Symbol</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Side</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Lots</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Open Price</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Current Price</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">P&L</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-8 text-center text-gray-500">No open trades</td>
                  </tr>
                ) : (
                  openTrades.map((trade) => {
                    const pnl = calculateFloatingPnl(trade)
                    const currentPrice = livePrices[trade.symbol]?.bid || trade.openPrice
                    return (
                      <tr key={trade._id} className="border-b border-gray-800 hover:bg-dark-700/50">
                        <td className="py-4 px-4 text-white font-medium">{trade.symbol}</td>
                        <td className="py-4 px-4">
                          <span className={`flex items-center gap-1 ${trade.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                            {trade.side === 'BUY' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                            {trade.side}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-white">{trade.quantity}</td>
                        <td className="py-4 px-4 text-gray-400">{formatPrice(trade.openPrice, trade.symbol)}</td>
                        <td className="py-4 px-4 text-gray-400">{formatPrice(currentPrice, trade.symbol)}</td>
                        <td className={`py-4 px-4 font-medium ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden p-3 space-y-3">
            {openTrades.length === 0 ? (
              <div className="py-8 text-center text-gray-500">No open trades</div>
            ) : (
              openTrades.map((trade) => {
                const pnl = calculateFloatingPnl(trade)
                const currentPrice = livePrices[trade.symbol]?.bid || trade.openPrice
                return (
                  <div key={trade._id} className="bg-dark-700 rounded-lg p-4 border border-gray-600">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{trade.symbol}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          trade.side === 'BUY' 
                            ? 'bg-green-500/20 text-green-400' 
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {trade.side}
                        </span>
                      </div>
                      <span className={`font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">Lots:</span>
                        <span className="text-white ml-2">{trade.quantity}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Open:</span>
                        <span className="text-gray-300 ml-2">{formatPrice(trade.openPrice, trade.symbol)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Current:</span>
                        <span className="text-gray-300 ml-2">{formatPrice(currentPrice, trade.symbol)}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Trade History */}
        <div className="bg-dark-800 rounded-xl border border-gray-700">
          <div className="p-4 md:p-6 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">Trade History ({closedTrades.length})</h2>
          </div>
          
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Symbol</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Side</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Lots</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Open Price</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Close Price</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">P&L</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Closed At</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="py-8 text-center text-gray-500">No trade history</td>
                  </tr>
                ) : (
                  closedTrades.slice(0, 20).map((trade) => (
                    <tr key={trade._id} className="border-b border-gray-800 hover:bg-dark-700/50">
                      <td className="py-4 px-4 text-white font-medium">{trade.symbol}</td>
                      <td className="py-4 px-4">
                        <span className={`flex items-center gap-1 ${trade.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                          {trade.side === 'BUY' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                          {trade.side}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-white">{trade.quantity}</td>
                      <td className="py-4 px-4 text-gray-400">{formatPrice(trade.openPrice, trade.symbol)}</td>
                      <td className="py-4 px-4 text-gray-400">{formatPrice(trade.closePrice, trade.symbol)}</td>
                      <td className={`py-4 px-4 font-medium ${(trade.realizedPnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {(trade.realizedPnl || 0) >= 0 ? '+' : ''}${(trade.realizedPnl || 0).toFixed(2)}
                      </td>
                      <td className="py-4 px-4 text-gray-400 text-sm">
                        {trade.closedAt ? new Date(trade.closedAt).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden p-3 space-y-3">
            {closedTrades.length === 0 ? (
              <div className="py-8 text-center text-gray-500">No trade history</div>
            ) : (
              closedTrades.slice(0, 20).map((trade) => (
                <div key={trade._id} className="bg-dark-700 rounded-lg p-4 border border-gray-600">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold">{trade.symbol}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        trade.side === 'BUY' 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {trade.side}
                      </span>
                    </div>
                    <span className={`font-bold ${(trade.realizedPnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {(trade.realizedPnl || 0) >= 0 ? '+' : ''}${(trade.realizedPnl || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">Lots:</span>
                      <span className="text-white ml-2">{trade.quantity}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Open:</span>
                      <span className="text-gray-300 ml-2">{formatPrice(trade.openPrice, trade.symbol)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Close:</span>
                      <span className="text-gray-300 ml-2">{formatPrice(trade.closePrice, trade.symbol)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Time:</span>
                      <span className="text-gray-300 ml-2">
                        {trade.closedAt ? new Date(trade.closedAt).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default InvestorDashboard
