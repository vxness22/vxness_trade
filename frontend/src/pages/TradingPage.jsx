import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react'

import toast from 'react-hot-toast'

import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Search, Star, X, Plus, Minus, Settings, Home, Wallet, LayoutGrid, BarChart3, Pencil, Trophy, AlertTriangle, Sun, Moon, FileCheck, Clock, Layers } from 'lucide-react'

import metaApiService from '../services/metaApi'

import priceStreamService from '../services/priceStream'

import { useTheme } from '../context/ThemeContext'

import { API_URL } from '../config/api'

import { adjustQuotesForTradingDisplay } from '../services/chargePricing'

import { marginUsd as computeMarginUsd } from '../utils/margin'

import { isMarketOpen, marketClosedReason } from '../utils/marketHours'

import TradingViewChart from '../components/TradingViewChart'

import KycTradeRequiredModal from '../components/KycTradeRequiredModal'



const TradingPage = () => {

  const navigate = useNavigate()

  const { accountId } = useParams()

  const [searchParams] = useSearchParams()

  const accountType = searchParams.get('type') // 'challenge' or null for regular

  const { isDarkMode, toggleDarkMode } = useTheme()

  

  const [account, setAccount] = useState(null)

  const [challengeAccount, setChallengeAccount] = useState(null)

  const [challengeRules, setChallengeRules] = useState(null)

  const [loading, setLoading] = useState(true)

  const [chartLoading, setChartLoading] = useState(false)

  const [selectedInstrument, setSelectedInstrument] = useState({ symbol: 'XAUUSD', name: 'CFDs on Gold (US$ / OZ)', bid: 0, ask: 0, spread: 0 })

  const [showInstruments, setShowInstruments] = useState(window.innerWidth >= 768)

  const [showOrderPanel, setShowOrderPanel] = useState(window.innerWidth >= 768)

  const [orderTab, setOrderTab] = useState('Market')

  const [volume, setVolume] = useState('0.01')

  const [leverage, setLeverage] = useState('1:100')

  const [searchTerm, setSearchTerm] = useState('')

  const [activeCategory, setActiveCategory] = useState('All')

  const [activePositionTab, setActivePositionTab] = useState('Positions')

  const [oneClickTrading, setOneClickTrading] = useState(false)

  const [selectedSide, setSelectedSide] = useState('BUY') // BUY or SELL

  // Ticks every 30s so the weekend market-open check re-evaluates around the
  // Saturday/Sunday (UTC) boundary even when no price ticks are arriving.
  const [marketClock, setMarketClock] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setMarketClock(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  // Whether the currently selected instrument can be traded right now.
  // Crypto is always open; forex/metals/commodities/indices are closed on weekends.
  const marketOpen = isMarketOpen(selectedInstrument?.symbol, marketClock)
  const marketClosedMsg = marketClosedReason(selectedInstrument?.symbol, marketClock)

  const [openTabs, setOpenTabs] = useState([{ symbol: 'XAUUSD', name: 'CFDs on Gold (US$ / OZ)', bid: 0, ask: 0, spread: 0 }])

  const [activeTab, setActiveTab] = useState('XAUUSD')

  const [showTakeProfit, setShowTakeProfit] = useState(false)

  const [showStopLoss, setShowStopLoss] = useState(false)

  const [takeProfit, setTakeProfit] = useState('')

  const [stopLoss, setStopLoss] = useState('')

  const [pendingOrderType, setPendingOrderType] = useState('BUY LIMIT')

  const [entryPrice, setEntryPrice] = useState('')

  // Initialize with empty instruments - will be fetched from API

  const [instruments, setInstruments] = useState([])

  const [loadingInstruments, setLoadingInstruments] = useState(true)

  const [starredSymbols, setStarredSymbols] = useState(['XAUUSD', 'EURUSD', 'GBPUSD', 'BTCUSD'])

  

  // Fetch all instruments from API

  const fetchInstruments = async () => {

    try {

      const res = await fetch(`${API_URL}/prices/instruments`)

      const data = await res.json()

      if (data.success && data.instruments) {

        const instrumentsWithState = data.instruments.map(inst => ({

          ...inst,

          bid: 0,

          ask: 0,

          spread: 0,

          change: 0,

          starred: starredSymbols.includes(inst.symbol)

        }))

        setInstruments(instrumentsWithState)

        setLoadingInstruments(false)

      } else {

        setLoadingInstruments(false)

      }

    } catch (err) {

      console.error('Error fetching instruments:', err)

      setLoadingInstruments(false)

    }

  }

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  // Height (px) of the positions panel — draggable from its top edge to grow/shrink the chart
  const [positionsHeight, setPositionsHeight] = useState(() => (window.innerWidth < 768 ? 128 : 176))

  const startPanelResize = (e) => {
    e.preventDefault()
    const startY = e.touches ? e.touches[0].clientY : e.clientY
    const startH = positionsHeight
    const onMove = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY
      // dragging up (smaller y) grows the panel; clamp so chart + panel stay usable
      const next = Math.min(Math.max(startH + (startY - y), 90), window.innerHeight - 220)
      setPositionsHeight(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
  }

  const [openTrades, setOpenTrades] = useState([])

  const [pendingOrders, setPendingOrders] = useState([])

  const [tradeHistory, setTradeHistory] = useState([])

  // Positions view: false = one netted row per currency (with trade count badge),
  // true = flat list of every individual trade across all currencies.
  const [nettingShowAllTrades, setNettingShowAllTrades] = useState(false)
  // Which currency rows are expanded (in netted view) to reveal their own trades
  const [expandedNettingSymbols, setExpandedNettingSymbols] = useState(() => new Set())

  const [isExecutingTrade, setIsExecutingTrade] = useState(false)

  const [tradeError, setTradeError] = useState('')

  const [tradeSuccess, setTradeSuccess] = useState('')

  const [accountSummary, setAccountSummary] = useState({

    balance: 0,

    credit: 0,

    equity: 0,

    usedMargin: 0,

    freeMargin: 0,

    floatingPnl: 0

  })

  const [livePrices, setLivePrices] = useState({}) // Store live prices separately

  // Combined live P/L of all open trades (real-time, shown centered in the bottom status bar)
  const liveTotalPnl = useMemo(() => openTrades.reduce((sum, trade) => {
    const lp = livePrices[trade.symbol]
    const inst = instruments.find(i => i.symbol === trade.symbol) || selectedInstrument
    const cur = lp ? (trade.side === 'BUY' ? lp.bid : lp.ask) : (trade.side === 'BUY' ? inst.bid : inst.ask)
    const pnl = trade.side === 'BUY'
      ? (cur - trade.openPrice) * trade.quantity * trade.contractSize
      : (trade.openPrice - cur) * trade.quantity * trade.contractSize
    return sum + pnl
  }, 0), [openTrades, livePrices, instruments, selectedInstrument])

  const [adminCommissions, setAdminCommissions] = useState({}) // Admin commission per symbol (instruments column)

  const [adminSpreads, setAdminSpreads] = useState({}) // Admin spread per symbol (Forex Charges → Spread)

  

  // Modal states for iOS-style popups

  const [showModifyModal, setShowModifyModal] = useState(false)

  const [showCloseModal, setShowCloseModal] = useState(false)

  const [showCloseAllModal, setShowCloseAllModal] = useState(false)

  const [selectedTradeForModify, setSelectedTradeForModify] = useState(null)

  const [selectedTradeForClose, setSelectedTradeForClose] = useState(null)

  const [closeAllType, setCloseAllType] = useState('all') // 'all', 'profit', 'loss'

  const [modifySL, setModifySL] = useState('')

  const [modifyTP, setModifyTP] = useState('')

  

  // Kill Switch states

  const [showKillSwitchModal, setShowKillSwitchModal] = useState(false)

  const [killSwitchActive, setKillSwitchActive] = useState(false)

  const [killSwitchEndTime, setKillSwitchEndTime] = useState(null)

  const [killSwitchDuration, setKillSwitchDuration] = useState({ value: 30, unit: 'minutes' })

  const [killSwitchTimeLeft, setKillSwitchTimeLeft] = useState('')

  const [globalNotification, setGlobalNotification] = useState('')

  // kycApproved: null = still checking, true = KYC approved, false = not approved.
  const [kycApproved, setKycApproved] = useState(null)
  const [kycDetailStatus, setKycDetailStatus] = useState(null)
  // Modal shown when a DEMO user without approved KYC tries to place an order.
  const [showKycModal, setShowKycModal] = useState(false)

  // Demo accounts may VIEW the trade terminal without KYC — the KYC gate is enforced
  // only when they actually place an order (Buy/Sell). Real & challenge accounts stay
  // fully locked until an admin approves KYC (unchanged behaviour).
  const isDemoAccount = account?.isDemo === true || account?.accountTypeId?.isDemo === true
  const kycAllowed = kycApproved === true
    ? true
    : kycApproved === null
      ? null
      : account
        ? (isDemoAccount ? true : false) // approved=false: demo can view, real is locked
        : null // approved=false but account not loaded yet → keep showing loader

  const categories = ['All', 'Starred', 'Forex', 'Metals', 'Crypto']



  const user = JSON.parse(localStorage.getItem('user') || '{}')



  const accountTypeKeyForCharges =

    account?.accountTypeId?._id?.toString?.() ||

    account?.accountTypeId?.toString?.() ||

    ''



  const instrumentsSymbolsParam = useMemo(

    () =>

      [...new Set(instruments.map((i) => (i.symbol || '').toString().toUpperCase().trim()).filter(Boolean))].join(

        ','

      ),

    [instruments]

  )



  const fetchAdminSpreads = useCallback(async () => {

    try {

      const qs = new URLSearchParams()

      if (accountTypeKeyForCharges) qs.set('accountTypeId', accountTypeKeyForCharges)

      if (user?._id) qs.set('userId', String(user._id))

      if (instrumentsSymbolsParam) qs.set('symbols', instrumentsSymbolsParam)

      // Cache buster — guarantees we never see a stale browser/proxy-cached response when admin deletes a charge

      qs.set('_t', String(Date.now()))

      const suffix = qs.toString() ? `?${qs.toString()}` : ''

      const res = await fetch(`${API_URL}/charges/spreads${suffix}`, {

        cache: 'no-store',

        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }

      })

      const data = await res.json()

      // Always replace (never merge) — keys missing from the new response mean those spreads were deleted

      if (data.success) setAdminSpreads(data.spreads || {})

    } catch (error) {

      console.error('Error fetching admin spreads:', error)

    }

  }, [accountTypeKeyForCharges, user?._id, instrumentsSymbolsParam])



  const fetchAdminCommissions = useCallback(async () => {

    try {

      const qs = new URLSearchParams()

      if (accountTypeKeyForCharges) qs.set('accountTypeId', accountTypeKeyForCharges)

      if (user?._id) qs.set('userId', String(user._id))

      if (instrumentsSymbolsParam) qs.set('symbols', instrumentsSymbolsParam)

      qs.set('_t', String(Date.now()))

      const suffix = qs.toString() ? `?${qs.toString()}` : ''

      const res = await fetch(`${API_URL}/charges/commissions${suffix}`, {

        cache: 'no-store',

        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }

      })

      const data = await res.json()

      if (data.success) setAdminCommissions(data.commissions || {})

    } catch (error) {

      console.error('Error fetching admin commissions:', error)

    }

  }, [accountTypeKeyForCharges, user?._id, instrumentsSymbolsParam])



  const getDisplayQuotes = useCallback(

    (symbol, bid, ask) => {

      const k = (symbol || '').toUpperCase()

      const spreadEntry = adminSpreads[k] || adminSpreads[symbol]

      const commEntry = adminCommissions[k] || adminCommissions[symbol]

      return adjustQuotesForTradingDisplay(Number(bid), Number(ask), symbol, spreadEntry, commEntry)

    },

    [adminSpreads, adminCommissions]

  )



  const formatTradePrice = (symbol, price) => {

    const n = Number(price)

    if (!Number.isFinite(n) || n <= 0) return '...'

    const sym = symbol || ''

    if (sym.includes('JPY')) return n.toFixed(3)

    if (['BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD'].includes(sym)) return n.toFixed(2)

    return n.toFixed(5)

  }



  // Toggle star/watchlist

  const toggleStar = (symbol) => {

    setStarredSymbols(prev => {

      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]

      // Update instruments state to reflect starred flag

      setInstruments(insts => insts.map(inst => inst.symbol === symbol ? { ...inst, starred: next.includes(symbol) } : inst))

      return next

    })

  }



  useEffect(() => {
    const verifyKyc = async () => {
      const token = localStorage.getItem('token')
      const stored = JSON.parse(localStorage.getItem('user') || '{}')
      if (!token || !stored._id) {
        navigate('/user/login')
        setKycApproved(false)
        return
      }
      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const data = await res.json()
        if (data.forceLogout || res.status === 403) {
          toast.error(data.message || 'Session expired. Please login again.')
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          navigate('/user/login')
          setKycApproved(false)
          return
        }
        if (data.user) {
          const merged = { ...stored, ...data.user }
          localStorage.setItem('user', JSON.stringify(merged))
          if (data.user.kycApproved) {
            setKycApproved(true)
            setKycDetailStatus(null)
            return
          }
        }
        let detail = null
        try {
          const kRes = await fetch(`${API_URL}/kyc/status/${stored._id}`)
          const kData = await kRes.json()
          if (kData.success && kData.hasKYC && kData.kyc?.status) {
            detail = kData.kyc.status
          }
        } catch (_) {}
        // KYC record is approved even if the user.kycApproved flag wasn't synced — allow trading
        if (detail === 'approved') {
          setKycApproved(true)
          setKycDetailStatus(null)
          return
        }
        setKycDetailStatus(detail)
        setKycApproved(false)
      } catch (e) {
        console.error('KYC gate error:', e)
        setKycApproved(false)
      }
    }
    verifyKyc()
  }, [navigate])

  // Load the account itself regardless of KYC status. We need to know whether it's a
  // demo account BEFORE deciding whether to lock the terminal (demo can view without KYC).
  useEffect(() => {

    if (!accountId) return

    fetchAccount()

  }, [accountId, accountType])

  useEffect(() => {

    if (kycAllowed !== true) return

    // Fetch all instruments from API

    fetchInstruments()

    // Fetch live prices in background - don't block UI

    fetchLivePrices()



    // Refresh prices every 2 seconds for real-time P/L updates

    const priceInterval = setInterval(() => {

      fetchLivePrices()

    }, 2000)



    return () => {

      clearInterval(priceInterval)

      metaApiService.disconnect()

    }

  }, [accountId, kycAllowed])



  useEffect(() => {

    if (kycAllowed !== true) return

    fetchAdminSpreads()

  }, [kycAllowed, fetchAdminSpreads])



  useEffect(() => {

    if (kycAllowed !== true) return

    fetchAdminCommissions()

  }, [kycAllowed, fetchAdminCommissions])



  // Live refresh: jab admin se koi charge create/update/delete hota hai, socket event aate hi
  // user trading panel auto-refresh ho jata hai with the latest spread/commission values.
  // Optimistic clear on delete guarantees the stale entry vanishes immediately, even before refetch.
  useEffect(() => {

    if (kycAllowed !== true) return

    const unsubscribe = priceStreamService.onChargesUpdated((payload) => {

      if (payload?.action === 'delete') {

        setAdminSpreads({})

        setAdminCommissions({})

      }

      // Refresh charges + any data that displays/uses them, so the UI is fully in sync.

      fetchAdminSpreads()

      fetchAdminCommissions()

      try { fetchOpenTrades?.() } catch {}

      try { fetchPendingOrders?.() } catch {}

      try { fetchAccountSummary?.() } catch {}

      // Skip the toast on the very first auto-sync that fires when the socket connects (payload.reason === 'reconnect').

      if (payload?.reason !== 'reconnect') {

        const action = payload?.action

        const msg = action === 'delete'

          ? 'Trading charges updated (a charge was removed)'

          : action === 'create'

            ? 'Trading charges updated (a new charge was added)'

            : 'Trading charges updated'

        toast.success(msg, { id: 'charges-updated', duration: 2500 })

      }

    })

    return unsubscribe

  }, [kycAllowed, fetchAdminSpreads, fetchAdminCommissions])



  // Safety net: refetch charges when the tab regains focus / becomes visible.

  // Covers cases where a socket event was missed (network blip, suspended tab, etc).

  useEffect(() => {

    if (kycAllowed !== true) return

    const handleVisible = () => {

      if (document.visibilityState === 'visible') {

        fetchAdminSpreads()

        fetchAdminCommissions()

      }

    }

    window.addEventListener('focus', handleVisible)

    document.addEventListener('visibilitychange', handleVisible)

    return () => {

      window.removeEventListener('focus', handleVisible)

      document.removeEventListener('visibilitychange', handleVisible)

    }

  }, [kycAllowed, fetchAdminSpreads, fetchAdminCommissions])



  // Fetch open trades and account summary when account is loaded

  useEffect(() => {

    if (!accountId || kycAllowed !== true) return

      fetchOpenTrades()

      fetchPendingOrders()

      fetchTradeHistory()

      fetchAccountSummary()

      

      // Refresh account data every 5 seconds to keep balance in sync

      const accountInterval = setInterval(() => {

        fetchOpenTrades()

        fetchAccountSummary()

      }, 5000)

      

      return () => clearInterval(accountInterval)

  }, [accountId, kycAllowed])



  // Handle responsive layout

  useEffect(() => {

    const handleResize = () => {

      const mobile = window.innerWidth < 768

      setIsMobile(mobile)

      // Keep order panel visible on desktop, hide on mobile by default

      if (!mobile) {

        setShowOrderPanel(true)

        setShowInstruments(true)

      }

    }

    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)

  }, [])



  // Real-time price updates via WebSocket for institutional-grade streaming

  useEffect(() => {

    if (kycAllowed !== true) return

    // Subscribe to WebSocket price stream

    const unsubscribe = priceStreamService.subscribe('tradingPage', (prices, updated, timestamp) => {

      // Only update if we have valid prices (prevent flickering to zero)

      if (!prices || Object.keys(prices).length === 0) return

      

      // Merge prices to prevent losing existing data

      setLivePrices(prev => {

        const merged = { ...prev }

        Object.entries(prices).forEach(([symbol, price]) => {

          if (price && price.bid) {

            merged[symbol] = price

          }

        })

        return merged

      })

      

      // Update instruments with live prices (only if price is valid)

      setInstruments(prev => prev.map(inst => {

        const priceData = prices[inst.symbol]

        if (priceData && priceData.bid && priceData.bid > 0) {

          const bid = priceData.bid

          const ask = priceData.ask || priceData.bid

          const spread = Math.abs(ask - bid) || (bid * 0.0001)

          return { ...inst, bid, ask, spread }

        }

        return inst

      }))

      

      // Update selected instrument (only if price is valid)

      const selectedPrice = prices[selectedInstrument?.symbol]

      if (selectedPrice && selectedPrice.bid && selectedPrice.bid > 0) {

        setSelectedInstrument(prev => ({

          ...prev,

          bid: selectedPrice.bid,

          ask: selectedPrice.ask || selectedPrice.bid,

          spread: Math.abs((selectedPrice.ask || selectedPrice.bid) - selectedPrice.bid)

        }))

      }

    })

    

    // Fallback: also fetch via HTTP for initial load

    fetchLivePrices()

    

    return () => unsubscribe()

  }, [selectedInstrument?.symbol, kycAllowed])



  // Kill Switch - Check localStorage on load and update timer

  useEffect(() => {

    // Check auth status on mount

    const checkAuthStatus = async () => {

      const token = localStorage.getItem('token')

      const user = JSON.parse(localStorage.getItem('user') || '{}')

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

    checkAuthStatus()



    // Check if kill switch is active from localStorage

    const savedKillSwitch = localStorage.getItem(`killSwitch_${accountId}`)

    if (savedKillSwitch) {

      const endTime = parseInt(savedKillSwitch)

      if (endTime > Date.now()) {

        setKillSwitchActive(true)

        setKillSwitchEndTime(endTime)

      } else {

        localStorage.removeItem(`killSwitch_${accountId}`)

      }

    }

  }, [accountId])



  // Kill Switch countdown timer

  useEffect(() => {

    if (!killSwitchActive || !killSwitchEndTime) return

    

    const updateTimer = () => {

      const now = Date.now()

      const remaining = killSwitchEndTime - now

      

      if (remaining <= 0) {

        setKillSwitchActive(false)

        setKillSwitchEndTime(null)

        setKillSwitchTimeLeft('')

        localStorage.removeItem(`killSwitch_${accountId}`)

        return

      }

      

      // Format time remaining

      const days = Math.floor(remaining / (1000 * 60 * 60 * 24))

      const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))

      const seconds = Math.floor((remaining % (1000 * 60)) / 1000)

      

      let timeStr = ''

      if (days > 0) timeStr += `${days}d `

      if (hours > 0 || days > 0) timeStr += `${hours}h `

      if (minutes > 0 || hours > 0 || days > 0) timeStr += `${minutes}m `

      timeStr += `${seconds}s`

      

      setKillSwitchTimeLeft(timeStr.trim())

    }

    

    updateTimer()

    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)

  }, [killSwitchActive, killSwitchEndTime, accountId])



  // Update account summary when prices change (for real-time equity/margin)

  useEffect(() => {

    // Skip if no live prices yet (prevent flickering to zero)

    if (Object.keys(livePrices).length === 0) return

    

    // Calculate total floating PnL from current prices

    let totalFloatingPnl = 0

    let totalUsedMargin = 0

    let hasValidPrices = false

    

    if (openTrades.length > 0) {

      openTrades.forEach(trade => {

        // Use livePrices first, fallback to instruments

        const livePrice = livePrices[trade.symbol]

        const inst = instruments.find(i => i.symbol === trade.symbol)

        

        // Only calculate if we have a valid price

        const currentPrice = livePrice?.bid 

          ? (trade.side === 'BUY' ? livePrice.bid : livePrice.ask)

          : (inst?.bid ? (trade.side === 'BUY' ? inst.bid : inst.ask) : null)

        

        if (currentPrice && currentPrice > 0) {

          hasValidPrices = true

          const pnl = trade.side === 'BUY'

            ? (currentPrice - trade.openPrice) * trade.quantity * trade.contractSize

            : (trade.openPrice - currentPrice) * trade.quantity * trade.contractSize

          totalFloatingPnl += pnl - (trade.commission || 0) - (trade.swap || 0)

        }

        totalUsedMargin += trade.marginUsed || 0

      })

    }

    

    // Only update if we have valid prices (prevent flickering to zero)

    if (!hasValidPrices && openTrades.length > 0) return

    

    // Always update account summary with real-time values

    const newEquity = Math.round((accountSummary.balance + (accountSummary.credit || 0) + totalFloatingPnl) * 100) / 100

    const newFreeMargin = Math.round((accountSummary.balance + (accountSummary.credit || 0) + totalFloatingPnl - totalUsedMargin) * 100) / 100

    

    setAccountSummary(prev => ({

      ...prev,

      floatingPnl: Math.round(totalFloatingPnl * 100) / 100,

      usedMargin: Math.round(totalUsedMargin * 100) / 100,

      equity: newEquity,

      freeMargin: newFreeMargin

    }))

    

    // CRITICAL: Check for stop out condition - equity <= 0 or free margin < 0

    if (openTrades.length > 0 && (newEquity <= 0 || newFreeMargin < -totalUsedMargin)) {

      checkStopOut()

    }

  }, [livePrices, instruments, openTrades])



  

  // Fetch live prices in background (non-blocking)

  const fetchLivePrices = async () => {

    try {

      // Get symbols from instruments for price display

      const instrumentSymbols = instruments.map(i => i.symbol)

      

      // Always include XAUUSD for SL/TP checking even if not in instruments

      const defaultSymbols = ['XAUUSD', 'EURUSD', 'GBPUSD']

      const allSymbols = [...new Set([...instrumentSymbols, ...defaultSymbols])]

      

      if (allSymbols.length === 0) return

      

      // Single batch call to backend (handles both MetaAPI and Binance)

      const allPrices = await metaApiService.getAllPrices(allSymbols)

      

      // Always update livePrices state for open trades display

      if (Object.keys(allPrices).length > 0) {

        setLoadingInstruments(false) // Prices loaded

        setLivePrices(prev => ({ ...prev, ...allPrices }))

        

        setInstruments(prev => prev.map(inst => {

          const priceData = allPrices[inst.symbol]

          if (priceData && priceData.bid) {

            // Use bid for both if ask not provided, add small spread

            const bid = priceData.bid

            const ask = priceData.ask || priceData.bid

            const spread = Math.abs(ask - bid) || (bid * 0.0001) // Default spread if same

            return {

              ...inst,

              bid: bid,

              ask: ask,

              spread: spread

            }

          }

          return inst

        }))

        

        // Update selected instrument with live prices

        setSelectedInstrument(prev => {

          const priceData = allPrices[prev.symbol]

          if (priceData && priceData.bid) {

            const bid = priceData.bid

            const ask = priceData.ask || priceData.bid

            return {

              ...prev,

              bid: bid,

              ask: ask,

              spread: Math.abs(ask - bid) || (bid * 0.0001)

            }

          }

          return prev

        })

        

        // Update open tabs with live prices

        setOpenTabs(prev => prev.map(tab => {

          const priceData = allPrices[tab.symbol]

          if (priceData && priceData.bid) {

            const bid = priceData.bid

            const ask = priceData.ask || priceData.bid

            return {

              ...tab,

              bid: bid,

              ask: ask,

              spread: Math.abs(ask - bid) || (bid * 0.0001)

            }

          }

          return tab

        }))



        // Check pending orders and SL/TP for all trades

        if (Object.keys(allPrices).length > 0) {

          try {

            // Check pending orders for execution

            const pendingRes = await fetch(`${API_URL}/trade/check-pending`, {

              method: 'POST',

              headers: { 'Content-Type': 'application/json' },

              body: JSON.stringify({ prices: allPrices })

            })

            const pendingData = await pendingRes.json()

            if (pendingData.success && pendingData.executedCount > 0) {

              fetchOpenTrades()

              fetchPendingOrders()

              pendingData.executedTrades.forEach(et => {

                setTradeSuccess(`${et.orderType} executed: ${et.symbol} ${et.side} @ ${formatTradePrice(et.symbol, et.executionPrice)}`)

              })

            }

            

            // Check SL/TP for all trades (auto-close when hit)

            // Always call check-sltp - backend will query all open trades

            const slTpRes = await fetch(`${API_URL}/trade/check-sltp`, {

              method: 'POST',

              headers: { 'Content-Type': 'application/json' },

              body: JSON.stringify({ prices: allPrices })

            })

            if (!slTpRes.ok) {

              console.error('SL/TP check failed:', slTpRes.status)

              return

            }

            const slTpData = await slTpRes.json()

            if (slTpData.success && slTpData.closedCount > 0) {

              console.log('SL/TP triggered:', slTpData.closedTrades)

              // Refresh trades if any were closed by SL/TP

              fetchOpenTrades()

              fetchTradeHistory()

              // Show notification

              slTpData.closedTrades.forEach(ct => {

                setTradeSuccess(`Trade ${ct.symbol} closed by ${ct.reason}: ${ct.pnl >= 0 ? '+' : ''}$${ct.pnl.toFixed(2)}`)

              })

            }

          } catch (e) {

            console.error('SL/TP check error:', e)

          }

        }

      }

    } catch (e) {

      console.error('Live prices error:', e)

    }

  }



  const SEGMENT_ORDER = ['Forex', 'Metals', 'Crypto', 'Indices', 'Commodities']

  const getSymbolCategory = (symbol, instrument = null) => {
    const cat = instrument?.category
    if (cat && SEGMENT_ORDER.includes(cat)) return cat

    const s = (symbol || '').toUpperCase()
    if (s.includes('XAU') || s.includes('XAG') || s.includes('XPT') || s.includes('XPD')) return 'Metals'
    if (s.includes('US30') || s.includes('US500') || s.includes('NAS100') || s.includes('SPX') || s.includes('NDX') ||
        s.includes('US100') || s.includes('GER40') || s.includes('UK100') || s.includes('DJ30') || s.includes('DAX') || s.includes('FTSE')) {
      return 'Indices'
    }
    if (s.includes('OIL') || s.includes('BRENT') || s.includes('WTI') || s === 'NGAS' || s === 'COPPER') return 'Commodities'
    if (s.endsWith('USD') && s.length >= 6 && !/^(EUR|GBP|AUD|NZD|CAD|CHF|USD)(USD|JPY|CHF|CAD|AUD|NZD|GBP|EUR)/.test(s) && s !== 'USDCAD' && s !== 'USDCHF' && s !== 'USDJPY') {
      const base = s.replace('USD', '')
      const fiat = ['EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'CHF', 'JPY', 'SGD', 'HKD', 'ZAR', 'MXN', 'TRY', 'PLN', 'SEK', 'NOK', 'DKK', 'CNH', 'HUF', 'CZK']
      if (base.length >= 3 && !fiat.includes(base.slice(0, 3)) && base.length <= 12) return 'Crypto'
    }
    return 'Forex'
  }



  const formatInstrumentCommission = (entry) => {

    if (!entry || !(entry.commission > 0)) return null

    if (entry.commissionType === 'PERCENTAGE') {

      return `${Number(entry.commission)}%`

    }

    const n = Number(entry.commission)

    return Number.isInteger(n) ? String(n) : n.toFixed(2)

  }



  /** Admin spread value as shown between Bid/Ask (uses category so XAG/XAU work before bid loads). */

  const formatAdminSpreadForInstrument = (inst, spreadEntry) => {

    const v = Number(spreadEntry?.spread ?? spreadEntry?.spreadValue)

    if (!spreadEntry || !Number.isFinite(v) || v < 0) return null

    // Admin sets spread in PIPS directly, no conversion needed
    // Just display the value as-is with appropriate decimal places
    const sym = (inst.symbol || '').toUpperCase()

    const cat = inst.category || getSymbolCategory(sym, inst)

    if (cat === 'Metals' || cat === 'Indices' || cat === 'Commodities' || cat === 'Crypto') {

      return Number(v).toFixed(2)

    }

    // Forex pairs - display as-is (admin enters in pips)
    return Number(v).toFixed(1)

  }



  const formatInstrumentChargeCell = (inst) => {

    const symKey = (inst.symbol || '').toUpperCase()

    const spreadStr = formatAdminSpreadForInstrument(inst, adminSpreads[symKey] || adminSpreads[inst.symbol])

    if (spreadStr != null) return spreadStr

    const commStr = formatInstrumentCommission(adminCommissions[symKey] || adminCommissions[inst.symbol])

    if (commStr != null) return commStr

    return '0'

  }



  // Fetch open trades

  const fetchOpenTrades = async () => {

    try {

      const res = await fetch(`${API_URL}/trade/open/${accountId}`)

      const data = await res.json()

      if (data.success) {

        setOpenTrades(data.trades || [])

      }

    } catch (error) {

      console.error('Error fetching open trades:', error)

    }

  }



  // Fetch pending orders

  const fetchPendingOrders = async () => {

    try {

      const res = await fetch(`${API_URL}/trade/pending/${accountId}`)

      const data = await res.json()

      if (data.success) {

        setPendingOrders(data.trades || [])

      }

    } catch (error) {

      console.error('Error fetching pending orders:', error)

    }

  }



  // Fetch trade history (closed trades)

  const fetchTradeHistory = async () => {

    try {

      const res = await fetch(`${API_URL}/trade/history/${accountId}`)

      const data = await res.json()

      if (data.success) {

        setTradeHistory(data.trades || [])

      }

    } catch (error) {

      console.error('Error fetching trade history:', error)

    }

  }



  // Fetch netting data (aggregated positions by instrument)


  // Fetch account summary with current prices

  const fetchAccountSummary = async () => {

    try {

      // Build prices object from instruments

      const pricesObj = {}

      instruments.forEach(inst => {

        if (inst.bid && inst.ask) {

          pricesObj[inst.symbol] = { bid: inst.bid, ask: inst.ask }

        }

      })

      

      const pricesParam = encodeURIComponent(JSON.stringify(pricesObj))

      const res = await fetch(`${API_URL}/trade/summary/${accountId}?prices=${pricesParam}`)

      const data = await res.json()

      if (data.success) {

        setAccountSummary(data.summary)

      }

    } catch (error) {

      console.error('Error fetching account summary:', error)

    }

  }



  // Check stop out - close all trades if equity goes negative

  const checkStopOut = async () => {

    try {

      const pricesObj = {}

      instruments.forEach(inst => {

        if (inst.bid && inst.ask) {

          pricesObj[inst.symbol] = { bid: inst.bid, ask: inst.ask }

        }

      })



      const res = await fetch(`${API_URL}/trade/check-stopout`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          tradingAccountId: accountId,

          prices: pricesObj

        })

      })



      const data = await res.json()

      if (data.success && data.stopOutTriggered) {

        toast.error(`⚠️ STOP OUT: ${data.message}\n\nAll your trades have been closed to prevent further losses.`)

        fetchOpenTrades()

        fetchAccountSummary()

        fetchTradeHistory()

      }

    } catch (error) {

      console.error('Error checking stop out:', error)

    }

  }



  // Activate Kill Switch

  const activateKillSwitch = (customDuration = null) => {

    const multipliers = { seconds: 1000, minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 }

    const durationConfig = customDuration || killSwitchDuration

    const duration = durationConfig.value * multipliers[durationConfig.unit]

    const endTime = Date.now() + duration

    

    setKillSwitchActive(true)

    setKillSwitchEndTime(endTime)

    localStorage.setItem(`killSwitch_${accountId}`, endTime.toString())

    setShowKillSwitchModal(false)

    

    // Show global notification at top

    const timeStr = `${durationConfig.value} ${durationConfig.unit}`

    setGlobalNotification(`🛑 Kill Switch activated for ${timeStr}! Trading is now blocked.`)

    setTimeout(() => setGlobalNotification(''), 5000)

  }



  // Quick activate Kill Switch with default 30 minutes (one-click)

  const quickActivateKillSwitch = () => {

    activateKillSwitch({ value: 30, unit: 'minutes' })

  }



  // Deactivate Kill Switch

  const deactivateKillSwitch = () => {

    setKillSwitchActive(false)

    setKillSwitchEndTime(null)

    setKillSwitchTimeLeft('')

    localStorage.removeItem(`killSwitch_${accountId}`)

    

    // Show global notification at top

    setGlobalNotification('✅ Kill Switch deactivated. Trading is now enabled.')

    setTimeout(() => setGlobalNotification(''), 3000)

  }



  // Execute Market Order (BUY or SELL)

  const executeMarketOrder = async (side) => {

    // KYC gate: demo users can view the terminal, but placing an order requires
    // admin-approved KYC. Show the KYC modal instead of executing.
    if (kycApproved !== true) {

      setShowKycModal(true)

      return

    }

    // Check Kill Switch

    if (killSwitchActive) {

      setTradeError(`Trading blocked! Kill Switch active for ${killSwitchTimeLeft}`)

      return

    }

    // Weekend market-closed guard (crypto stays open 24/7)

    if (!isMarketOpen(selectedInstrument?.symbol)) {

      setTradeError('Market is closed on weekends for this instrument. Trading will resume when the market reopens.')

      return

    }



    setIsExecutingTrade(true)

    setTradeError('')

    setTradeSuccess('')



    try {

      const segment = getSymbolCategory(selectedInstrument.symbol, selectedInstrument)

      

      // Use livePrices first (real-time), fallback to selectedInstrument

      const livePrice = livePrices[selectedInstrument.symbol]

      const bid = livePrice?.bid || selectedInstrument.bid

      const ask = livePrice?.ask || selectedInstrument.ask

      

      if (!bid || !ask || bid <= 0 || ask <= 0 || isNaN(bid) || isNaN(ask)) {

        setTradeError('Market is closed or no price data available. Trading is not available at this time.')

        setIsExecutingTrade(false)

        return

      }

      

      const res = await fetch(`${API_URL}/trade/open`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          userId: user._id,

          tradingAccountId: accountId,

          symbol: selectedInstrument.symbol,

          segment,

          side,

          orderType: 'MARKET',

          quantity: parseFloat(volume),

          bid,

          ask,

          leverage: leverage, // Send selected leverage

          sl: showStopLoss && stopLoss ? parseFloat(stopLoss) : null,

          tp: showTakeProfit && takeProfit ? parseFloat(takeProfit) : null

        })

      })



      const data = await res.json()



      if (data.success) {

        setTradeSuccess(`${side} order executed successfully!`)

        fetchOpenTrades()

        fetchAccountSummary()

        // Clear SL/TP after successful trade

        setStopLoss('')

        setTakeProfit('')

        setShowStopLoss(false)

        setShowTakeProfit(false)

      } else {

        // Check if account failed due to rule violations

        if (data.accountFailed) {

          // Redirect to account page with fail reason

          navigate(`/account?failed=true&reason=${encodeURIComponent(data.failReason || data.message)}`)

          return

        }

        

        // Show warning count if available

        if (data.warningCount > 0) {

          setTradeError(`${data.message} (Warning ${data.warningCount}/3 - ${data.remainingWarnings} remaining before account fails)`)

        } else {

          setTradeError(data.message || 'Failed to execute order')

        }

      }

    } catch (error) {

      console.error('Error executing trade:', error)

      setTradeError('Failed to execute order. Please try again.')

    }



    setIsExecutingTrade(false)

    

    // Clear messages after 3 seconds

    setTimeout(() => {

      setTradeError('')

      setTradeSuccess('')

    }, 3000)

  }



  // Execute Pending Order

  const executePendingOrder = async () => {

    // KYC gate: demo users can view the terminal, but placing an order requires
    // admin-approved KYC. Show the KYC modal instead of executing.
    if (kycApproved !== true) {

      setShowKycModal(true)

      return

    }

    // Check Kill Switch

    if (killSwitchActive) {

      setTradeError(`Trading blocked! Kill Switch active for ${killSwitchTimeLeft}`)

      return

    }

    // Weekend market-closed guard (crypto stays open 24/7)

    if (!isMarketOpen(selectedInstrument?.symbol)) {

      setTradeError('Market is closed on weekends for this instrument. Trading will resume when the market reopens.')

      return

    }



    setIsExecutingTrade(true)

    setTradeError('')

    setTradeSuccess('')



    try {

      const segment = getSymbolCategory(selectedInstrument.symbol, selectedInstrument)

      const side = pendingOrderType.includes('BUY') ? 'BUY' : 'SELL'

      const orderType = pendingOrderType.replace(' ', '_')



      // For pending orders, use entry price; fallback to live prices

      const pendingPrice = entryPrice ? parseFloat(entryPrice) : null

      const livePrice = livePrices[selectedInstrument.symbol]

      const currentBid = livePrice?.bid || selectedInstrument.bid

      const currentAsk = livePrice?.ask || selectedInstrument.ask

      

      const res = await fetch(`${API_URL}/trade/open`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          userId: user._id,

          tradingAccountId: accountId,

          symbol: selectedInstrument.symbol,

          segment,

          side,

          orderType,

          quantity: parseFloat(volume),

          bid: pendingPrice || currentBid,

          ask: pendingPrice || currentAsk,

          sl: showStopLoss && stopLoss ? parseFloat(stopLoss) : null,

          tp: showTakeProfit && takeProfit ? parseFloat(takeProfit) : null

        })

      })



      const data = await res.json()



      if (data.success) {

        setTradeSuccess(`${pendingOrderType} order placed successfully!`)

        fetchPendingOrders()

        setEntryPrice('')

      } else {

        setTradeError(data.message || 'Failed to place order')

      }

    } catch (error) {

      console.error('Error placing pending order:', error)

      setTradeError('Failed to place order. Please try again.')

    }



    setIsExecutingTrade(false)

    

    setTimeout(() => {

      setTradeError('')

      setTradeSuccess('')

    }, 3000)

  }



  // Close a trade

  const closeTrade = async (tradeId) => {

    try {

      const trade = openTrades.find(t => t._id === tradeId)

      if (!trade) return



      // Use livePrices first (real-time), fallback to instruments

      const livePrice = livePrices[trade.symbol]

      const instrument = instruments.find(i => i.symbol === trade.symbol) || selectedInstrument

      

      const bid = livePrice?.bid || instrument.bid

      const ask = livePrice?.ask || instrument.ask

      

      if (!bid || !ask || bid === 0 || ask === 0) {

        setTradeError('Price not available. Please wait for prices to load.')

        return

      }



      const res = await fetch(`${API_URL}/trade/close`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          tradeId,

          bid,

          ask

        })

      })



      const data = await res.json()



      if (data.success) {

        setTradeSuccess(`Trade closed. P/L: $${data.realizedPnl?.toFixed(2)}`)

        fetchOpenTrades()

        fetchTradeHistory()

        fetchAccountSummary()

      } else {

        setTradeError(data.message || 'Failed to close trade')

      }

    } catch (error) {

      console.error('Error closing trade:', error)

      setTradeError('Failed to close trade')

    }



    setTimeout(() => {

      setTradeError('')

      setTradeSuccess('')

    }, 3000)

  }



  // Cancel pending order

  const cancelPendingOrder = async (tradeId) => {

    try {

      const res = await fetch(`${API_URL}/trade/cancel`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ tradeId })

      })



      const data = await res.json()



      if (data.success) {

        setTradeSuccess('Order cancelled')

        fetchPendingOrders()

      } else {

        setTradeError(data.message || 'Failed to cancel order')

      }

    } catch (error) {

      console.error('Error cancelling order:', error)

      setTradeError('Failed to cancel order')

    }



    setTimeout(() => {

      setTradeError('')

      setTradeSuccess('')

    }, 3000)

  }



  // Open modify SL/TP modal

  const openModifyModal = (trade) => {

    setSelectedTradeForModify(trade)

    // Check both sl/stopLoss and tp/takeProfit fields for compatibility

    setModifySL((trade.sl || trade.stopLoss)?.toString() || '')

    setModifyTP((trade.tp || trade.takeProfit)?.toString() || '')

    setShowModifyModal(true)

  }



  // Modify trade SL/TP

  const handleModifyTrade = async () => {

    console.log('handleModifyTrade called')

    

    if (!selectedTradeForModify) {

      console.log('No trade selected for modify')

      setTradeError('No trade selected')

      return

    }



    console.log('Modifying trade:', selectedTradeForModify._id, 'SL:', modifySL, 'TP:', modifyTP)

    setTradeError('') // Clear any previous error



    try {

      const requestBody = {

        tradeId: selectedTradeForModify._id,

        sl: modifySL ? parseFloat(modifySL) : null,

        tp: modifyTP ? parseFloat(modifyTP) : null

      }

      console.log('Request body:', JSON.stringify(requestBody))



      const res = await fetch(`${API_URL}/trade/modify`, {

        method: 'PUT',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify(requestBody)

      })



      console.log('Response status:', res.status)

      const data = await res.json()

      console.log('Response data:', data)



      if (data.success) {

        setTradeSuccess('Trade modified successfully')

        fetchOpenTrades()

        setShowModifyModal(false)

      } else {

        console.log('Modify failed:', data.message)

        // If trade is not open, refresh the trades list

        if (data.message?.includes('not open') || data.message?.includes('not found')) {

          fetchOpenTrades()

          setTradeError('This trade is no longer open. Refreshing...')

          setTimeout(() => setShowModifyModal(false), 1500)

        } else {

          setTradeError(data.message || 'Failed to modify trade')

        }

      }

    } catch (error) {

      console.error('Error modifying trade:', error)

      setTradeError('Failed to modify trade: ' + error.message)

    }



    setTimeout(() => {

      setTradeError('')

      setTradeSuccess('')

    }, 3000)

  }



  // Open close confirmation modal

  const openCloseModal = (trade) => {

    setSelectedTradeForClose(trade)

    setShowCloseModal(true)

  }



  // Confirm close trade

  const handleConfirmClose = async () => {

    if (!selectedTradeForClose) return

    await closeTrade(selectedTradeForClose._id)

    setShowCloseModal(false)

  }



  // Close all trades (all, profit only, or loss only)

  const handleCloseAllTrades = async (type) => {

    setCloseAllType(type)

    setShowCloseAllModal(true)

  }



  const confirmCloseAll = async () => {

    const tradesToClose = openTrades.filter(trade => {

      // Use livePrices first, fallback to instruments

      const livePrice = livePrices[trade.symbol]

      const inst = instruments.find(i => i.symbol === trade.symbol) || selectedInstrument

      const currentPrice = livePrice 

        ? (trade.side === 'BUY' ? livePrice.bid : livePrice.ask)

        : (trade.side === 'BUY' ? inst.bid : inst.ask)

      const pnl = trade.side === 'BUY' 

        ? (currentPrice - trade.openPrice) * trade.quantity * trade.contractSize

        : (trade.openPrice - currentPrice) * trade.quantity * trade.contractSize



      if (closeAllType === 'profit') return pnl > 0

      if (closeAllType === 'loss') return pnl < 0

      return true // 'all'

    })



    for (const trade of tradesToClose) {

      await closeTrade(trade._id)

    }



    setShowCloseAllModal(false)

    setTradeSuccess(`Closed ${tradesToClose.length} trade(s)`)

    setTimeout(() => setTradeSuccess(''), 3000)

  }



  const fetchAccount = async () => {

    setLoading(true)

    try {

      if (accountType === 'challenge') {

        // Fetch challenge account dashboard

        const res = await fetch(`${API_URL}/prop/account/${accountId}`)

        const data = await res.json()

        if (data.success && data.account) {

          setChallengeAccount(data)

          setChallengeRules(data.rules || {})

          // Get max leverage from challenge rules

          const challengeMaxLeverage = data.rules?.maxLeverage || 100

          // Create a compatible account object for the trading UI

          setAccount({

            _id: data.account._id,

            accountId: data.account.accountId,

            balance: data.balance?.current || 0,

            equity: data.balance?.equity || 0,

            leverage: `1:${challengeMaxLeverage}`,

            accountType: 'CHALLENGE',

            status: data.account.status

          })

          setLeverage(`1:${challengeMaxLeverage}`)

        } else {

          navigate('/account')

        }

      } else {

        // Fetch regular trading account

        const res = await fetch(`${API_URL}/trading-accounts/user/${user._id}`)

        const data = await res.json()

        const acc = data.accounts?.find(a => a._id === accountId)

        if (acc) {

          setAccount(acc)

          setLeverage(acc.leverage || '1:100')

        } else {

          navigate('/account')

        }

      }

    } catch (error) {

      console.error('Error fetching account:', error)

    }

    setLoading(false)

  }



  const getSymbolForTradingView = (symbol) => {

    if (!symbol) return 'OANDA:XAUUSD'

    

    // Crypto mappings - use BINANCE with USDT pairs for best coverage

    const cryptoMap = {

      'BTCUSD': 'BINANCE:BTCUSDT', 'ETHUSD': 'BINANCE:ETHUSDT', 'BNBUSD': 'BINANCE:BNBUSDT',

      'SOLUSD': 'BINANCE:SOLUSDT', 'XRPUSD': 'BINANCE:XRPUSDT', 'ADAUSD': 'BINANCE:ADAUSDT',

      'DOGEUSD': 'BINANCE:DOGEUSDT', 'TRXUSD': 'BINANCE:TRXUSDT', 'LINKUSD': 'BINANCE:LINKUSDT',

      'MATICUSD': 'BINANCE:MATICUSDT', 'DOTUSD': 'BINANCE:DOTUSDT', 'SHIBUSD': 'BINANCE:SHIBUSDT',

      'LTCUSD': 'BINANCE:LTCUSDT', 'BCHUSD': 'BINANCE:BCHUSDT', 'AVAXUSD': 'BINANCE:AVAXUSDT',

      'XLMUSD': 'BINANCE:XLMUSDT', 'UNIUSD': 'BINANCE:UNIUSDT', 'ATOMUSD': 'BINANCE:ATOMUSDT',

      'ETCUSD': 'BINANCE:ETCUSDT', 'FILUSD': 'BINANCE:FILUSDT', 'ICPUSD': 'BINANCE:ICPUSDT',

      'VETUSD': 'BINANCE:VETUSDT', 'NEARUSD': 'BINANCE:NEARUSDT', 'GRTUSD': 'BINANCE:GRTUSDT',

      'AAVEUSD': 'BINANCE:AAVEUSDT', 'MKRUSD': 'BINANCE:MKRUSDT', 'ALGOUSD': 'BINANCE:ALGOUSDT',

      'FTMUSD': 'BINANCE:FTMUSDT', 'SANDUSD': 'BINANCE:SANDUSDT', 'MANAUSD': 'BINANCE:MANAUSDT',

      'AXSUSD': 'BINANCE:AXSUSDT', 'THETAUSD': 'BINANCE:THETAUSDT', 'XMRUSD': 'BINANCE:XMRUSDT',

      'FLOWUSD': 'BINANCE:FLOWUSDT', 'SNXUSD': 'BINANCE:SNXUSDT', 'EOSUSD': 'BINANCE:EOSUSDT',

      'CHZUSD': 'BINANCE:CHZUSDT', 'ENJUSD': 'BINANCE:ENJUSDT', 'ZILUSD': 'BINANCE:ZILUSDT',

      'BATUSD': 'BINANCE:BATUSDT', 'CRVUSD': 'BINANCE:CRVUSDT', 'COMPUSD': 'BINANCE:COMPUSDT',

      'SUSHIUSD': 'BINANCE:SUSHIUSDT', 'ZRXUSD': 'BINANCE:ZRXUSDT', 'LRCUSD': 'BINANCE:LRCUSDT',

      'ANKRUSD': 'BINANCE:ANKRUSDT', 'GALAUSD': 'BINANCE:GALAUSDT', 'APEUSD': 'BINANCE:APEUSDT',

      'WAVESUSD': 'BINANCE:WAVESUSDT', 'ZECUSD': 'BINANCE:ZECUSDT',

    }

    

    if (cryptoMap[symbol]) return cryptoMap[symbol]

    

    // Forex pairs (6 char with USD, EUR, GBP, JPY, CHF, AUD, NZD, CAD)

    const forexCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'SGD', 'HKD', 'NOK', 'SEK', 'DKK', 'PLN', 'ZAR', 'MXN', 'TRY', 'CNH']

    if (symbol.length === 6) {

      const base = symbol.substring(0, 3)

      const quote = symbol.substring(3, 6)

      if (forexCurrencies.includes(base) && forexCurrencies.includes(quote)) {

        return `OANDA:${symbol}`

      }

    }

    

    // Metals

    if (symbol.startsWith('XAU') || symbol.startsWith('XAG') || symbol.startsWith('XPT') || symbol.startsWith('XPD')) {

      return `OANDA:${symbol}`

    }

    

    // Indices

    if (symbol.includes('US30') || symbol.includes('SPX') || symbol.includes('US500')) return 'FOREXCOM:SPXUSD'

    if (symbol.includes('NAS') || symbol.includes('NDX') || symbol.includes('US100')) return 'FOREXCOM:NSXUSD'

    if (symbol.includes('DJI') || symbol.includes('DJ30')) return 'FOREXCOM:DJI'

    if (symbol.includes('DAX') || symbol.includes('GER')) return 'PEPPERSTONE:GER40'

    if (symbol.includes('UK100') || symbol.includes('FTSE')) return 'PEPPERSTONE:UK100'

    

    // Oil

    if (symbol.includes('OIL') || symbol.includes('WTI') || symbol.includes('CRUDE')) return 'TVC:USOIL'

    if (symbol.includes('BRENT')) return 'TVC:UKOIL'

    

    // US Stocks - try NASDAQ first

    const usStocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'AMD', 'NFLX', 'ABBV', 'ABT', 'ADBE']

    if (usStocks.includes(symbol) || (symbol.length <= 5 && /^[A-Z]+$/.test(symbol))) {

      return `NASDAQ:${symbol}`

    }

    

    // Default: try FX for currency-like, otherwise skip chart

    if (symbol.endsWith('USD') && symbol.length > 6) {

      // Crypto-like symbol

      return `COINBASE:${symbol}`

    }

    

    return `OANDA:${symbol}`

  }



  // Only show instruments where bid & ask are both live (> 0) — same as what the row displays.

  const hasValidBidAsk = (inst) => {

    const b = Number(inst.bid)

    const a = Number(inst.ask)

    return Number.isFinite(b) && Number.isFinite(a) && b > 0 && a > 0

  }

  const filteredInstruments = instruments.filter(inst => {

    const matchesSearch = inst.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||

      inst.name.toLowerCase().includes(searchTerm.toLowerCase())

    

    if (searchTerm.length > 0) {

      return matchesSearch && hasValidBidAsk(inst)

    }

    

    if (activeCategory === 'Starred') {

      return inst.starred && hasValidBidAsk(inst)

    }

    

    if (activeCategory === 'All') {

      return hasValidBidAsk(inst)

    }



    return inst.category === activeCategory && hasValidBidAsk(inst)

  })



  const handleInstrumentClick = (inst) => {

    const existingTab = openTabs.find(tab => tab.symbol === inst.symbol)

    if (!existingTab) {

      setOpenTabs([...openTabs, inst])

    }

    setActiveTab(inst.symbol)

    setSelectedInstrument(inst)

    

    // When clicking from search, mark instrument as "added" so it shows in its category

    if (searchTerm.length > 0 && !inst.popular) {

      setInstruments(prevInsts => prevInsts.map(i => 

        i.symbol === inst.symbol ? { ...i, popular: true } : i

      ))

    }

    

    // Clear search after selection

    setSearchTerm('')

  }



  const handleTabClick = (symbol) => {

    setActiveTab(symbol)

    const inst = openTabs.find(tab => tab.symbol === symbol)

    if (inst) {

      setSelectedInstrument(inst)

    }

  }



  const handleCloseTab = (e, symbol) => {

    e.stopPropagation()

    if (openTabs.length === 1) return

    const newTabs = openTabs.filter(tab => tab.symbol !== symbol)

    setOpenTabs(newTabs)

    if (activeTab === symbol) {

      setActiveTab(newTabs[0].symbol)

      setSelectedInstrument(newTabs[0])

    }

  }



  const calculateMargin = () => {

    const vol = parseFloat(volume) || 0

    const price = selectedInstrument.ask || 0

    const lev = parseInt(leverage?.split(':')[1]) || 100

    // Currency-aware margin (USD-quoted / USD-base / cross pairs) using live rates
    const getQuote = (sym) => livePrices[sym] || instruments.find(i => i.symbol === sym) || null

    return computeMarginUsd(selectedInstrument.symbol, vol, price, lev, getQuote).toFixed(2)

  }



  if (kycAllowed === null) {

    return (

      <div className={`h-screen flex items-center justify-center ${isDarkMode ? 'bg-black' : 'bg-gray-100'}`}>

        <div className={isDarkMode ? 'text-white' : 'text-gray-900'}>Loading...</div>

      </div>

    )

  }

  if (kycAllowed === false) {

    const title = kycDetailStatus === 'pending'
      ? 'KYC Under Review'
      : kycDetailStatus === 'rejected'
        ? 'KYC Rejected'
        : 'KYC Not Submitted'

    const subtitle = kycDetailStatus === 'pending'
      ? 'Your documents are being reviewed. You can use the trade terminal after an admin approves your verification.'
      : kycDetailStatus === 'rejected'
        ? 'Please update your documents in your profile and resubmit for approval.'
        : 'Complete your KYC verification to unlock all features'

    return (

      <div className={`h-screen flex items-center justify-center p-6 ${isDarkMode ? 'bg-black' : 'bg-gray-100'}`}>

        <div className={`max-w-md w-full rounded-2xl border p-8 text-center ${isDarkMode ? 'bg-[#0a0a0a] border-gray-800' : 'bg-white border-gray-200 shadow-lg'}`}>

          <div className={`flex items-center justify-center gap-2 mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>

            <FileCheck size={20} className={isDarkMode ? 'text-gray-300' : 'text-gray-600'} />

            <span className="font-semibold">KYC Verification</span>

          </div>

          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-500/20 flex items-center justify-center">

            {kycDetailStatus === 'pending' ? (

              <Clock size={36} className="text-amber-400" />

            ) : (

              <FileCheck size={36} className="text-amber-400" />

            )}

          </div>

          <h2 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h2>

          <p className={`text-sm mb-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{subtitle}</p>

          <button

            type="button"

            onClick={() => navigate('/profile')}

            className="w-full py-3 rounded-xl bg-[#3B82F6] text-black font-semibold hover:bg-[#2563EB] transition-colors"

          >

            {kycDetailStatus === 'pending' ? 'Back to Profile' : 'Start KYC Verification'}

          </button>

          <button

            type="button"

            onClick={() => navigate('/account')}

            className={`w-full mt-3 py-2 text-sm ${isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}

          >

            Return to accounts

          </button>

        </div>

      </div>

    )

  }

  if (loading) {

    return (

      <div className={`h-screen flex items-center justify-center ${isDarkMode ? 'bg-black' : 'bg-gray-100'}`}>

        <div className={isDarkMode ? 'text-white' : 'text-gray-900'}>Loading...</div>

      </div>

    )

  }



  return (

    <div className={`h-screen flex overflow-hidden text-sm transition-colors duration-300 ${isDarkMode ? 'bg-black' : 'bg-gray-100'}`}>

      {/* Left Sidebar */}

      <div className={`w-12 border-r flex flex-col items-center py-3 shrink-0 ${isDarkMode ? 'bg-[#0a0a0a] border-gray-800' : 'bg-white border-gray-200'}`}>

        <button 

          onClick={() => navigate('/account')}

          className={`w-9 h-9 flex items-center justify-center rounded-lg mb-2 transition-colors ${isDarkMode ? 'text-gray-500 hover:text-white hover:bg-[#1a1a1a]' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}

          title="Home"

        >

          <Home size={20} />

        </button>

        <button 

          onClick={() => setShowInstruments(!showInstruments)}

          className={`w-9 h-9 flex items-center justify-center rounded-lg mb-2 transition-colors ${

            showInstruments ? (isDarkMode ? 'text-white bg-[#1a1a1a]' : 'text-gray-900 bg-gray-100') : (isDarkMode ? 'text-gray-500 hover:text-white hover:bg-[#1a1a1a]' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100')

          }`}

          title="Instruments"

        >

          <LayoutGrid size={20} />

        </button>

        <button 

          onClick={() => navigate('/account')}

          className={`w-9 h-9 flex items-center justify-center rounded-lg mb-2 transition-colors ${isDarkMode ? 'text-gray-500 hover:text-white hover:bg-[#1a1a1a]' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}

          title="Wallet"

        >

          <Wallet size={20} />

        </button>

        <button 

          onClick={toggleDarkMode}

          className={`w-9 h-9 flex items-center justify-center rounded-lg mb-2 transition-colors ${isDarkMode ? 'text-gray-500 hover:text-white hover:bg-[#1a1a1a]' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}

          title={isDarkMode ? 'Light Mode' : 'Dark Mode'}

        >

          {isDarkMode ? <Sun size={20} className="text-yellow-400" /> : <Moon size={20} />}

        </button>

        <div className="flex-1" />

        <div className="w-6 h-6 rounded bg-red-500 flex items-center justify-center text-white text-xs font-bold cursor-pointer hover:bg-red-600" onClick={() => setShowInstruments(false)}>

          <X size={14} />

        </div>

      </div>



      {/* Main Content Area */}

      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Global Notification Banner - Top of Page */}

        {globalNotification && (

          <div className="fixed top-0 left-0 right-0 z-[100] animate-slide-down">

            <div className={`px-4 py-3 text-center font-medium text-sm shadow-lg ${

              globalNotification.includes('🛑') 

                ? 'bg-red-600 text-white' 

                : 'bg-green-600 text-white'

            }`}>

              {globalNotification}

            </div>

          </div>

        )}



        {/* Challenge Account Banner */}

        {accountType === 'challenge' && challengeAccount && (

          <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-b border-yellow-500/30 px-3 py-2 flex items-center justify-between shrink-0">

            <div className="flex items-center gap-3">

              <Trophy size={18} className="text-yellow-500" />

              <span className="text-yellow-500 font-medium text-sm">

                {challengeAccount.challenge?.name || 'Challenge'} - Phase {challengeAccount.account?.currentPhase}/{challengeAccount.account?.totalPhases}

              </span>

              <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>|</span>

              <span className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>

                Daily DD: <span className={challengeAccount.drawdown?.dailyUsed > 3 ? 'text-red-500' : 'text-green-500'}>{challengeAccount.drawdown?.dailyUsed?.toFixed(2) || 0}%</span> / {challengeAccount.drawdown?.dailyMax || 5}%

              </span>

              <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>|</span>

              <span className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>

                Overall DD: <span className={challengeAccount.drawdown?.overallUsed > 6 ? 'text-red-500' : 'text-green-500'}>{challengeAccount.drawdown?.overallUsed?.toFixed(2) || 0}%</span> / {challengeAccount.drawdown?.overallMax || 10}%

              </span>

              <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>|</span>

              <span className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>

                Profit: <span className="text-green-500">{challengeAccount.profit?.currentPercent?.toFixed(2) || 0}%</span> / {challengeAccount.profit?.targetPercent || 8}%

              </span>

            </div>

            <div className="flex items-center gap-2">

              <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{challengeAccount.time?.remainingDays || 0} days left</span>

              {challengeRules?.stopLossMandatory && (

                <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded flex items-center gap-1">

                  <AlertTriangle size={12} /> SL Required

                </span>

              )}

            </div>

          </div>

        )}

        

        {/* Top Header */}

        <header className={`h-10 sm:h-8 border-b flex items-center px-2 sm:px-3 shrink-0 ${isDarkMode ? 'bg-black border-gray-800' : 'bg-white border-gray-200'}`}>

          <span className={`font-medium text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{selectedInstrument.symbol}</span>

          {!isMobile && (

            <>

              <span className={`ml-3 text-xs ${accountType === 'challenge' ? 'text-yellow-500' : 'text-teal-400'}`}>

                {accountType === 'challenge'

                  ? 'Challenge'

                  : (account?.accountTypeId?.name || account?.accountTypeId?.displayName || 'Account')} - {account?.accountId}

              </span>

              <span className="text-gray-400 ml-3 text-xs">Balance: <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>${accountSummary.balance?.toFixed(2) || '0.00'}</span></span>

            </>

          )}

          <div className="flex-1" />

          {(() => {

            const lp = livePrices[selectedInstrument.symbol]

            const rb = lp?.bid ?? selectedInstrument.bid

            const ra = lp?.ask ?? selectedInstrument.ask

            const q = getDisplayQuotes(selectedInstrument.symbol, rb, ra)

            return (

              <>

                <span className="text-red-500 font-mono text-xs sm:text-sm mr-1 sm:mr-2">{formatTradePrice(selectedInstrument.symbol, q.bid)}</span>

                <span className="text-green-500 font-mono text-xs sm:text-sm mr-2 sm:mr-4">{formatTradePrice(selectedInstrument.symbol, q.ask)}</span>

              </>

            )

          })()}

          <button 

            onClick={() => setShowOrderPanel(!showOrderPanel)}

            className="bg-teal-500 hover:bg-teal-600 text-white text-xs px-2 sm:px-3 py-1 rounded"

          >

            {isMobile ? 'Order' : 'New Order'}

          </button>

          {/* Kill Switch Button - One click to activate (30min default), long press for options */}

          <button 

            onClick={() => killSwitchActive ? deactivateKillSwitch() : quickActivateKillSwitch()}

            onContextMenu={(e) => { e.preventDefault(); if (!killSwitchActive) setShowKillSwitchModal(true) }}

            className={`ml-2 text-xs px-2 sm:px-3 py-1 rounded flex items-center gap-1 ${

              killSwitchActive 

                ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' 

                : 'bg-orange-500 hover:bg-orange-600 text-white'

            }`}

            title={killSwitchActive ? `Click to deactivate (${killSwitchTimeLeft} left)` : 'Click: Activate 30min | Right-click: Custom duration'}

          >

            {killSwitchActive ? (

              <>

                <span className="hidden sm:inline">🛑 {killSwitchTimeLeft}</span>

                <span className="sm:hidden">🛑</span>

              </>

            ) : (

              <>

                <span className="hidden sm:inline">🛑 Kill Switch</span>

                <span className="sm:hidden">🛑</span>

              </>

            )}

          </button>

          <button onClick={() => setShowOrderPanel(!showOrderPanel)} className={`ml-1 sm:ml-2 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>

            <Settings size={16} />

          </button>

          <button 

            onClick={toggleDarkMode}

            className={`ml-1 sm:ml-2 p-1.5 rounded transition-colors ${isDarkMode ? 'text-yellow-400 hover:text-yellow-300' : 'text-blue-500 hover:text-blue-400'}`}

            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}

          >

            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}

          </button>

        </header>



        {/* Main Content */}

        <div className="flex-1 flex overflow-hidden">

          {/* Instruments Panel */}

          {showInstruments && (

            <div className={`${isMobile ? 'absolute inset-0 z-20' : 'w-[280px]'} border-r flex flex-col shrink-0 ${isDarkMode ? 'bg-[#0d0d0d] border-gray-800' : 'bg-white border-gray-200'}`}>

              {/* Header */}

              <div className={`px-3 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

                <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Instruments</span>

                <button onClick={() => setShowInstruments(false)} className={isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>

                  <X size={16} />

                </button>

              </div>

              {/* Search */}

              <div className={`px-3 py-2 ${isDarkMode ? 'bg-[#0d0d0d]' : 'bg-white'}`}>

                <div className="relative">

                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />

                  <input

                    type="text"

                    placeholder="Search instruments"

                    value={searchTerm}

                    onChange={(e) => setSearchTerm(e.target.value)}

                    className={`w-full rounded pl-9 pr-3 py-2 text-sm placeholder-gray-500 focus:outline-none border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700 text-white focus:border-gray-600' : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-gray-400'}`}

                  />

                </div>

              </div>

              

              {/* Category Tabs */}

              <div className={`flex items-center gap-1 px-3 py-2 border-b overflow-x-auto ${isDarkMode ? 'bg-[#0d0d0d] border-gray-800' : 'bg-white border-gray-200'}`}>

                <button className="text-gray-600 hover:text-yellow-500 shrink-0">

                  <Star size={14} />

                </button>

                {categories.map(cat => (

                  <button

                    key={cat}

                    onClick={() => setActiveCategory(cat)}

                    className={`px-2 py-1 rounded text-xs font-medium transition-colors shrink-0 ${

                      activeCategory === cat 

                        ? 'bg-blue-600 text-white' 

                        : isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'

                    }`}

                  >

                    {cat}

                  </button>

                ))}

              </div>



              {/* Instruments List */}

              <div className={`flex-1 overflow-y-auto px-2 ${!isDarkMode ? 'light-scrollbar' : ''}`}>

                {loadingInstruments ? (

                  <div className="flex items-center justify-center py-8">

                    <div className="text-gray-500 text-sm">Loading instruments...</div>

                  </div>

                ) : filteredInstruments.length === 0 ? (

                  <div className="flex items-center justify-center py-8">

                    <div className="text-gray-500 text-sm">No instruments found</div>

                  </div>

                ) : (

                  filteredInstruments.map(inst => (

                    <button

                      key={inst.symbol}

                      onClick={() => handleInstrumentClick(inst)}

                      className={`w-full px-3 py-2.5 my-1 flex items-center rounded-lg border transition-colors ${

                        selectedInstrument.symbol === inst.symbol 

                          ? (isDarkMode ? 'bg-[#1a1a1a] border-blue-500' : 'bg-blue-50 border-blue-500')

                          : (isDarkMode ? 'border-gray-700 hover:border-gray-600 hover:bg-[#1a1a1a]' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50')

                      }`}

                    >

                      <Star 

                        size={12} 

                        className={`shrink-0 mr-2 cursor-pointer hover:text-yellow-400 ${inst.starred ? 'text-yellow-500 fill-yellow-500' : 'text-gray-700'}`}

                        onClick={(e) => { e.stopPropagation(); toggleStar(inst.symbol); }}

                      />

                      <div className="text-left min-w-[55px]">

                        <div className={`text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{inst.symbol}</div>

                        <div className="text-green-500 text-[10px]">+{inst.change?.toFixed(2) || '0.00'}%</div>

                      </div>

                      <div className="flex-1" />

                      <div className="text-right w-16">

                        <div className="text-red-500 text-xs font-mono">

                          {(() => {

                            const dq = getDisplayQuotes(inst.symbol, inst.bid, inst.ask)

                            return dq.bid > 0 ? formatTradePrice(inst.symbol, dq.bid) : '...'

                          })()}

                        </div>

                        <div className={`text-[9px] ${isDarkMode ? 'text-gray-600' : 'text-gray-500'}`}>Bid</div>

                      </div>

                      <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium min-w-[28px] text-center mx-2 ${isDarkMode ? 'bg-[#2a2a2a] text-cyan-400' : 'bg-blue-100 text-blue-600'}`}>

                        {formatInstrumentChargeCell(inst)}

                      </div>

                      <div className="text-right w-14">

                        <div className="text-green-500 text-xs font-mono">

                          {(() => {

                            const dq = getDisplayQuotes(inst.symbol, inst.bid, inst.ask)

                            return dq.ask > 0 ? formatTradePrice(inst.symbol, dq.ask) : '...'

                          })()}

                        </div>

                        <div className={`text-[9px] ${isDarkMode ? 'text-gray-600' : 'text-gray-500'}`}>Ask</div>

                      </div>

                    </button>

                  ))

                )}

              </div>

              

              {/* Footer */}

              <div className={`px-3 py-2 border-t flex items-center justify-between shrink-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

                <span className="text-gray-500 text-xs">{filteredInstruments.length} instruments</span>

                <div className="flex items-center gap-1">

                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>

                  <span className="text-green-500 text-xs">Live</span>

                </div>

              </div>

            </div>

          )}



        {/* Center - Chart Area */}

        <div className={`flex-1 flex flex-col min-w-0 ${isDarkMode ? 'bg-[#0d0d0d]' : 'bg-gray-50'}`}>

          {/* Symbol Tab Bar */}

          <div className={`h-9 border-b flex items-center px-2 shrink-0 gap-1 ${isDarkMode ? 'bg-[#0d0d0d] border-gray-800' : 'bg-white border-gray-200'}`}>

            {openTabs.map(tab => (

              <div

                key={tab.symbol}

                onClick={() => handleTabClick(tab.symbol)}

                className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer transition-colors ${

                  activeTab === tab.symbol 

                    ? 'bg-blue-600 text-white' 

                    : isDarkMode ? 'bg-[#1a1a1a] text-gray-400 hover:bg-[#252525] hover:text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'

                }`}

              >

                <span className="text-sm font-medium">{tab.symbol}</span>

                {openTabs.length > 1 && (

                  <button 

                    onClick={(e) => handleCloseTab(e, tab.symbol)}

                    className="hover:text-red-400 ml-1"

                  >

                    <X size={12} />

                  </button>

                )}

              </div>

            ))}

            <button className={`ml-1 p-1.5 rounded ${isDarkMode ? 'text-gray-500 hover:text-white hover:bg-[#1a1a1a]' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'}`}>

              <Plus size={16} />

            </button>

          </div>



          {/* Chart — TradingView Charting Library with custom datafeed bound to MetaApi
              so candles + last price match the broker feed shown in the order panel. */}

          <div className={`flex-1 min-h-0 relative ${isDarkMode ? 'bg-[#0d0d0d]' : 'bg-white'}`}>

            <TradingViewChart

              symbol={selectedInstrument.symbol}

              interval="5"

              theme={isDarkMode ? 'dark' : 'light'}

            />

          </div>



          {/* Positions Panel */}

          <div style={{ height: `${positionsHeight}px` }} className={`border-t flex flex-col shrink-0 relative ${isDarkMode ? 'bg-[#0d0d0d] border-gray-800' : 'bg-white border-gray-200'}`}>

            {/* Drag handle: pull up/down to resize the chart vs positions panel */}
            <div
              onMouseDown={startPanelResize}
              onTouchStart={startPanelResize}
              title="Drag to resize"
              className="absolute -top-1.5 left-0 right-0 h-3 cursor-row-resize z-20 flex items-center justify-center group"
            >
              <div className={`w-12 h-1 rounded-full transition-colors ${isDarkMode ? 'bg-gray-700 group-hover:bg-blue-500' : 'bg-gray-300 group-hover:bg-blue-500'}`} />
            </div>

            <div className={`h-10 flex items-center justify-between px-2 sm:px-4 border-b overflow-x-auto ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

              <div className="flex gap-2 sm:gap-6">

                {[

                  { name: 'Positions', count: openTrades.length },

                  { name: 'Pending', count: pendingOrders.length },

                  { name: 'History', count: tradeHistory.length },

                  { name: 'Cancelled', count: 0 }

                ].map(tab => (

                  <button

                    key={tab.name}

                    onClick={() => setActivePositionTab(tab.name)}

                    className={`text-xs sm:text-sm whitespace-nowrap ${activePositionTab === tab.name ? (isDarkMode ? 'text-white' : 'text-gray-900') : (isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-500 hover:text-gray-900')}`}

                  >

                    {isMobile ? `${tab.name.split(' ')[0]}(${tab.count})` : `${tab.name}(${tab.count})`}

                  </button>

                ))}

              </div>

              <div className="flex items-center gap-2 sm:gap-3 shrink-0">

                {!isMobile && (

                  <>

                    <span className="text-sm text-gray-500">One Click</span>

                    <button

                      onClick={() => setOneClickTrading(!oneClickTrading)}

                      className={`w-10 h-5 rounded-full relative transition-colors ${oneClickTrading ? 'bg-blue-600' : 'bg-gray-600'}`}

                    >

                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${oneClickTrading ? 'left-5' : 'left-0.5'}`} />

                    </button>

                    {oneClickTrading && (

                      <>

                        <button 

                          onClick={() => executeMarketOrder('SELL')}

                          disabled={isExecutingTrade || !marketOpen}

                          title={!marketOpen ? (marketClosedMsg || 'Market closed') : ''}

                          className="w-8 h-8 rounded-full bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"

                        >

                          S

                        </button>

                        <input

                          type="text"

                          value={volume}

                          onChange={(e) => setVolume(e.target.value)}

                          className={`w-14 h-7 border rounded text-center text-sm font-medium focus:outline-none focus:border-blue-500 ${isDarkMode ? 'bg-[#1a1a1a] border-gray-600 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}

                        />

                        <button 

                          onClick={() => executeMarketOrder('BUY')}

                          disabled={isExecutingTrade || !marketOpen}

                          title={!marketOpen ? (marketClosedMsg || 'Market closed') : ''}

                          className="w-8 h-8 rounded-full bg-blue-500 text-white text-sm font-bold hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"

                        >

                          B

                        </button>

                      </>

                    )}

                  </>

                )}

              </div>

            </div>

            

            <div className="flex-1 overflow-auto">

              {activePositionTab === 'Positions' && (() => {
                // Group all open trades by currency/symbol, computing live P/L the
                // same way the Positions table does so the two views always agree.
                const groupsMap = {}
                openTrades.forEach(trade => {
                  const livePrice = livePrices[trade.symbol]
                  const inst = instruments.find(i => i.symbol === trade.symbol) || selectedInstrument
                  const currentPrice = livePrice
                    ? (trade.side === 'BUY' ? livePrice.bid : livePrice.ask)
                    : (trade.side === 'BUY' ? inst.bid : inst.ask)
                  const pnl = trade.side === 'BUY'
                    ? (currentPrice - trade.openPrice) * trade.quantity * trade.contractSize
                    : (trade.openPrice - currentPrice) * trade.quantity * trade.contractSize
                  if (!groupsMap[trade.symbol]) {
                    groupsMap[trade.symbol] = { symbol: trade.symbol, trades: [], longLots: 0, shortLots: 0, netPnl: 0, charges: 0, swap: 0, entrySum: 0, qtySum: 0, bid: 0, ask: 0 }
                  }
                  const g = groupsMap[trade.symbol]
                  g.trades.push({ ...trade, currentPrice, pnl })
                  if (trade.side === 'BUY') g.longLots += trade.quantity
                  else g.shortLots += trade.quantity
                  g.netPnl += pnl
                  g.charges += (trade.commission || 0)
                  g.swap += (trade.swap || 0)
                  g.entrySum += trade.openPrice * trade.quantity
                  g.qtySum += trade.quantity
                  g.bid = livePrice ? livePrice.bid : inst.bid
                  g.ask = livePrice ? livePrice.ask : inst.ask
                })

                const groups = Object.values(groupsMap).sort((a, b) => a.symbol.localeCompare(b.symbol))
                // Flat list of every individual trade (with its currency's total trade-count badge)
                const allTrades = groups.flatMap(g => g.trades.map(t => ({ ...t, symbolCount: g.trades.length })))

                const formatPrice = (symbol, price) => {
                  if (!price) return '-'
                  if (symbol.includes('JPY')) return price.toFixed(3)
                  if (['BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD'].includes(symbol)) return price.toFixed(2)
                  return price.toFixed(5)
                }

                const toggleSymbol = (symbol) => setExpandedNettingSymbols(prev => {
                  const next = new Set(prev)
                  if (next.has(symbol)) next.delete(symbol)
                  else next.add(symbol)
                  return next
                })

                const SymbolBadge = ({ symbol, count }) => (
                  <div className="flex items-center gap-1.5">
                    <span>{symbol}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isDarkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>{count}</span>
                  </div>
                )

                return (
                  <div className="p-2">
                    {/* "Show all trades" toggle */}
                    {groups.length > 0 && (
                      <div className="flex justify-end mb-2">
                        <button
                          onClick={() => setNettingShowAllTrades(v => !v)}
                          title={nettingShowAllTrades ? 'Show netted view (one row per currency)' : 'Show all trades of every currency'}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs whitespace-nowrap shrink-0 ${isDarkMode ? 'bg-[#262626] text-gray-200 hover:bg-[#333]' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-200'}`}
                        >
                          <Layers size={13} />
                          {nettingShowAllTrades ? 'Netted view' : 'Show all trades'}
                        </button>
                      </div>
                    )}

                    <table className="w-full text-sm">
                      <thead className={`text-gray-500 border-b sticky top-0 ${isDarkMode ? 'border-gray-800 bg-[#0d0d0d]' : 'border-gray-200 bg-white'}`}>
                        <tr>
                          <th className="text-left py-2 px-3 font-normal">Time</th>
                          <th className="text-left py-2 px-3 font-normal">Symbol</th>
                          <th className="text-left py-2 px-3 font-normal">Side</th>
                          <th className="text-left py-2 px-3 font-normal">Lots</th>
                          <th className="text-left py-2 px-3 font-normal">Entry</th>
                          <th className="text-left py-2 px-3 font-normal">Current</th>
                          <th className="text-left py-2 px-3 font-normal">SL</th>
                          <th className="text-left py-2 px-3 font-normal">TP</th>
                          <th className="text-left py-2 px-3 font-normal">Charges</th>
                          <th className="text-left py-2 px-3 font-normal">Swap</th>
                          <th className="text-left py-2 px-3 font-normal">P/L</th>
                          <th className="text-left py-2 px-3 font-normal">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.length === 0 ? (
                          <tr><td colSpan="12" className="text-center py-8 text-gray-500">No open positions</td></tr>
                        ) : nettingShowAllTrades ? (
                          /* ALL TRADES: flat list of every individual trade */
                          allTrades.map(trade => (
                            <tr key={trade._id} className={`border-t ${isDarkMode ? 'border-gray-800 hover:bg-[#1a1a1a]' : 'border-gray-200 hover:bg-gray-50'}`}>
                              <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{new Date(trade.openedAt || trade.createdAt).toLocaleString()}</td>
                              <td className={`py-2 px-3 text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{trade.symbol}</td>
                              <td className={`py-2 px-3 text-xs font-medium ${trade.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>{trade.side}</td>
                              <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{trade.quantity}</td>
                              <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatPrice(trade.symbol, trade.openPrice)}</td>
                              <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatPrice(trade.symbol, trade.currentPrice)}</td>
                              <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{trade.stopLoss ? formatPrice(trade.symbol, trade.stopLoss) : '-'}</td>
                              <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{trade.takeProfit ? formatPrice(trade.symbol, trade.takeProfit) : '-'}</td>
                              <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>${trade.commission?.toFixed(2) || '0.00'}</td>
                              <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>${trade.swap?.toFixed(2) || '0.00'}</td>
                              <td className={`py-2 px-3 text-xs font-medium ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)}</td>
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-1">
                                  <button onClick={() => openModifyModal(trade)} className="p-1.5 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 transition-colors" title="Modify SL/TP"><Pencil size={12} /></button>
                                  <button onClick={() => openCloseModal(trade)} className="p-1.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors" title="Close Trade"><X size={12} /></button>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          /* NETTED: one row per currency, click to expand its own trades */
                          groups.map(group => {
                            const netLots = group.longLots - group.shortLots
                            const netSide = netLots > 0 ? 'BUY' : netLots < 0 ? 'SELL' : 'FLAT'
                            const avgEntry = group.qtySum ? group.entrySum / group.qtySum : 0
                            const curPrice = netLots >= 0 ? group.bid : group.ask
                            const isExpanded = expandedNettingSymbols.has(group.symbol)
                            // Earliest opened trade of this currency, shown in the Time column
                            const firstTime = group.trades.reduce((min, t) => {
                              const d = new Date(t.openedAt || t.createdAt)
                              return (!min || d < min) ? d : min
                            }, null)
                            return (
                              <Fragment key={group.symbol}>
                                <tr onClick={() => toggleSymbol(group.symbol)} className={`border-t cursor-pointer ${isDarkMode ? 'border-gray-800 hover:bg-[#1a1a1a]' : 'border-gray-200 hover:bg-gray-50'}`}>
                                  <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{firstTime ? firstTime.toLocaleString() : '—'}</td>
                                  <td className={`py-2 px-3 text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    <SymbolBadge symbol={group.symbol} count={group.trades.length} />
                                  </td>
                                  <td className={`py-2 px-3 text-xs font-bold ${netSide === 'BUY' ? 'text-blue-400' : netSide === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>{netSide}</td>
                                  <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{Math.abs(netLots).toFixed(2)}</td>
                                  <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatPrice(group.symbol, avgEntry)}</td>
                                  <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatPrice(group.symbol, curPrice)}</td>
                                  <td className="py-2 px-3 text-xs text-gray-500">—</td>
                                  <td className="py-2 px-3 text-xs text-gray-500">—</td>
                                  <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>${group.charges.toFixed(2)}</td>
                                  <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>${group.swap.toFixed(2)}</td>
                                  <td className={`py-2 px-3 text-xs font-medium ${group.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{group.netPnl >= 0 ? '+' : '-'}${Math.abs(group.netPnl).toFixed(2)}</td>
                                  <td className="py-2 px-3"></td>
                                </tr>

                                {/* This currency's individual trades (shown on row click) */}
                                {isExpanded && group.trades.map(trade => (
                                  <tr key={trade._id} className={`border-t ${isDarkMode ? 'border-gray-800/60 bg-[#0a0a0a] hover:bg-[#1a1a1a]' : 'border-gray-100 bg-gray-50/50 hover:bg-gray-50'}`}>
                                    <td className="py-2 pl-6 pr-3 text-xs text-gray-500">{new Date(trade.openedAt || trade.createdAt).toLocaleString()}</td>
                                    <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{trade.symbol}</td>
                                    <td className={`py-2 px-3 text-xs font-medium ${trade.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>{trade.side}</td>
                                    <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{trade.quantity}</td>
                                    <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatPrice(trade.symbol, trade.openPrice)}</td>
                                    <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatPrice(trade.symbol, trade.currentPrice)}</td>
                                    <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{trade.stopLoss ? formatPrice(trade.symbol, trade.stopLoss) : '-'}</td>
                                    <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{trade.takeProfit ? formatPrice(trade.symbol, trade.takeProfit) : '-'}</td>
                                    <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>${trade.commission?.toFixed(2) || '0.00'}</td>
                                    <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>${trade.swap?.toFixed(2) || '0.00'}</td>
                                    <td className={`py-2 px-3 text-xs font-medium ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)}</td>
                                    <td className="py-2 px-3">
                                      <div className="flex items-center gap-1">
                                        <button onClick={(e) => { e.stopPropagation(); openModifyModal(trade) }} className="p-1.5 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 transition-colors" title="Modify SL/TP"><Pencil size={12} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); openCloseModal(trade) }} className="p-1.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors" title="Close Trade"><X size={12} /></button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </Fragment>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              })()}



              {activePositionTab === 'History' && (

              <table className="w-full text-sm">

                <thead className={`text-gray-500 border-b sticky top-0 ${isDarkMode ? 'border-gray-800 bg-[#0d0d0d]' : 'border-gray-200 bg-white'}`}>

                  <tr>

                    <th className="text-left py-2 px-3 font-normal">Closed</th>

                    <th className="text-left py-2 px-3 font-normal">Symbol</th>

                    <th className="text-left py-2 px-3 font-normal">Side</th>

                    <th className="text-left py-2 px-3 font-normal">Lots</th>

                    <th className="text-left py-2 px-3 font-normal">Entry</th>

                    <th className="text-left py-2 px-3 font-normal">Close</th>

                    <th className="text-left py-2 px-3 font-normal">Charges</th>

                    <th className="text-left py-2 px-3 font-normal">Swap</th>

                    <th className="text-left py-2 px-3 font-normal">P/L</th>

                  </tr>

                </thead>

                <tbody>

                  {tradeHistory.length === 0 ? (

                    <tr>

                      <td colSpan="9" className="text-center py-8 text-gray-500">No trade history</td>

                    </tr>

                  ) : (

                    tradeHistory.map(trade => {

                      const formatPrice = (price) => {

                        if (!price) return '-'

                        if (trade.symbol.includes('JPY')) return price.toFixed(3)

                        if (['BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD'].includes(trade.symbol)) return price.toFixed(2)

                        return price.toFixed(5)

                      }

                      

                      return (

                        <tr key={trade._id} className={`border-t ${isDarkMode ? 'border-gray-800 hover:bg-[#1a1a1a]' : 'border-gray-200 hover:bg-gray-50'}`}>

                          <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{new Date(trade.closedAt).toLocaleString()}</td>

                          <td className={`py-2 px-3 text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{trade.symbol}</td>

                          <td className={`py-2 px-3 text-xs font-medium ${trade.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>{trade.side}</td>

                          <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{trade.quantity}</td>

                          <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatPrice(trade.openPrice)}</td>

                          <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatPrice(trade.closePrice)}</td>

                          <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>${trade.commission?.toFixed(2) || '0.00'}</td>

                          <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>${trade.swap?.toFixed(2) || '0.00'}</td>

                          <td className={`py-2 px-3 text-xs font-medium ${trade.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>

                            {(trade.realizedPnl || 0) >= 0 ? '+' : '-'}${Math.abs(trade.realizedPnl || 0).toFixed(2)}

                          </td>

                        </tr>

                      )

                    })

                  )}

                </tbody>

              </table>

              )}



              {activePositionTab === 'Pending' && (

              <table className="w-full text-sm">

                <thead className={`text-gray-500 border-b sticky top-0 ${isDarkMode ? 'border-gray-800 bg-[#0d0d0d]' : 'border-gray-200 bg-white'}`}>

                  <tr>

                    <th className="text-left py-2 px-3 font-normal">Time</th>

                    <th className="text-left py-2 px-3 font-normal">Symbol</th>

                    <th className="text-left py-2 px-3 font-normal">Type</th>

                    <th className="text-left py-2 px-3 font-normal">Lots</th>

                    <th className="text-left py-2 px-3 font-normal">Price</th>

                    <th className="text-left py-2 px-3 font-normal">SL</th>

                    <th className="text-left py-2 px-3 font-normal">TP</th>

                    <th className="text-left py-2 px-3 font-normal">Action</th>

                  </tr>

                </thead>

                <tbody>

                  {pendingOrders.length === 0 ? (

                    <tr>

                      <td colSpan="8" className="text-center py-8 text-gray-500">No pending orders</td>

                    </tr>

                  ) : (

                    pendingOrders.map(order => (

                      <tr key={order._id} className={`border-t ${isDarkMode ? 'border-gray-800 hover:bg-[#1a1a1a]' : 'border-gray-200 hover:bg-gray-50'}`}>

                        <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{new Date(order.createdAt).toLocaleTimeString()}</td>

                        <td className={`py-2 px-3 text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{order.symbol}</td>

                        <td className={`py-2 px-3 text-xs font-medium ${order.orderType.includes('BUY') ? 'text-blue-400' : 'text-red-400'}`}>{order.orderType}</td>

                        <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{order.quantity}</td>

                        <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{formatTradePrice(order.symbol, order.pendingPrice)}</td>

                        <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{order.stopLoss ? formatTradePrice(order.symbol, order.stopLoss) : '-'}</td>

                        <td className={`py-2 px-3 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{order.takeProfit ? formatTradePrice(order.symbol, order.takeProfit) : '-'}</td>

                        <td className="py-2 px-3">

                          <button 

                            onClick={() => cancelPendingOrder(order._id)}

                            className="p-1.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"

                            title="Cancel Order"

                          >

                            <X size={12} />

                          </button>

                        </td>

                      </tr>

                    ))

                  )}

                </tbody>

              </table>

              )}



              {activePositionTab === 'Cancelled' && (

                <div className="text-center py-8 text-gray-500">No cancelled orders</div>

              )}

            </div>

          </div>

        </div>



        {/* Right Panel - Order */}

        {showOrderPanel && (

          <div className={`${isMobile ? 'absolute inset-0 z-20' : 'w-72'} border-l flex flex-col shrink-0 ${isDarkMode ? 'bg-[#0d0d0d] border-gray-800' : 'bg-white border-gray-200'}`}>

            <div className={`px-4 py-4 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

              <span className={`text-base font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{selectedInstrument.symbol} order</span>

              <button onClick={() => setShowOrderPanel(false)} className={isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}>

                <X size={18} />

              </button>

            </div>



            <div className={`flex border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

              <button

                onClick={() => setOrderTab('Market')}

                className={`flex-1 py-3 text-sm font-medium ${orderTab === 'Market' ? (isDarkMode ? 'text-white' : 'text-gray-900') + ' border-b-2 border-blue-500' : 'text-gray-500'}`}

              >

                Market

              </button>

              <button

                onClick={() => setOrderTab('Pending')}

                className={`flex-1 py-3 text-sm font-medium ${orderTab === 'Pending' ? (isDarkMode ? 'text-white' : 'text-gray-900') + ' border-b-2 border-blue-500' : 'text-gray-500'}`}

              >

                Pending

              </button>

            </div>



            {orderTab === 'Market' ? (

              <>

                <div className={`p-3 flex-1 overflow-y-auto ${!isDarkMode ? 'light-scrollbar' : ''}`}>

                  {/* Leverage Selector */}

                  <div className={`flex items-center justify-between rounded px-3 py-2 mb-3 border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700' : 'bg-gray-50 border-gray-300'}`}>

                    <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Leverage</span>

                    <select

                      value={leverage}

                      onChange={(e) => setLeverage(e.target.value)}

                      className="bg-transparent text-yellow-500 font-semibold text-sm focus:outline-none cursor-pointer"

                    >

                      <option value="1:10" className={isDarkMode ? 'bg-dark-800' : 'bg-white'}>1:10</option>

                      <option value="1:20" className={isDarkMode ? 'bg-dark-800' : 'bg-white'}>1:20</option>

                      <option value="1:50" className={isDarkMode ? 'bg-dark-800' : 'bg-white'}>1:50</option>

                      <option value="1:100" className={isDarkMode ? 'bg-dark-800' : 'bg-white'}>1:100</option>

                      <option value="1:200" className={isDarkMode ? 'bg-dark-800' : 'bg-white'}>1:200</option>

                      <option value="1:500" className={isDarkMode ? 'bg-dark-800' : 'bg-white'}>1:500</option>

                      <option value="1:1000" className={isDarkMode ? 'bg-dark-800' : 'bg-white'}>1:1000</option>

                      <option value="1:2000" className={isDarkMode ? 'bg-dark-800' : 'bg-white'}>1:2000</option>

                    </select>

                  </div>



                  {/* Weekend market-closed notice (crypto stays open 24/7) */}

                  {!marketOpen && (

                    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded bg-yellow-500/10 border border-yellow-500/40 text-yellow-500 text-xs">

                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />

                      <span>{marketClosedMsg || 'Market is closed.'} Buy/Sell is disabled until it reopens.</span>

                    </div>

                  )}



                  {/* One-Click Buy/Sell Buttons (prices include admin spread like execution) */}

                  {(() => {

                    const lp = livePrices[selectedInstrument.symbol]

                    const rb = lp?.bid ?? selectedInstrument.bid

                    const ra = lp?.ask ?? selectedInstrument.ask

                    const q = getDisplayQuotes(selectedInstrument.symbol, rb, ra)

                    return (

                  <div className="flex gap-2 mb-3">

                    <button

                      onClick={() => executeMarketOrder('SELL')}

                      disabled={isExecutingTrade || !marketOpen}

                      title={!marketOpen ? (marketClosedMsg || 'Market closed') : ''}

                      className="flex-1 rounded py-3 text-center transition-colors bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"

                    >

                      <div className="text-white text-[10px] font-medium">SELL</div>

                      <div className="text-white font-mono text-lg font-bold">

                        {formatTradePrice(selectedInstrument.symbol, q.bid)}

                      </div>

                    </button>

                    <button

                      onClick={() => executeMarketOrder('BUY')}

                      disabled={isExecutingTrade || !marketOpen}

                      title={!marketOpen ? (marketClosedMsg || 'Market closed') : ''}

                      className="flex-1 rounded py-3 text-center transition-colors bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"

                    >

                      <div className="text-white text-[10px] font-medium">BUY</div>

                      <div className="text-white font-mono text-lg font-bold">

                        {formatTradePrice(selectedInstrument.symbol, q.ask)}

                      </div>

                    </button>

                  </div>

                    )

                  })()}



                  {/* Side Selection for detailed order */}

                  <div className="flex gap-2 mb-3">

                    <button 

                      onClick={() => setSelectedSide('SELL')}

                      className={`flex-1 rounded py-1.5 text-center text-xs transition-colors ${

                        selectedSide === 'SELL' 

                          ? 'bg-red-500/20 border border-red-500 text-red-400' 

                          : isDarkMode ? 'bg-[#1a1a1a] border border-gray-600 text-gray-400 hover:border-red-500/50' : 'bg-gray-50 border border-gray-300 text-gray-600 hover:border-red-500/50'

                      }`}

                    >

                      Sell Side

                    </button>

                    <button 

                      onClick={() => setSelectedSide('BUY')}

                      className={`flex-1 rounded py-1.5 text-center text-xs transition-colors ${

                        selectedSide === 'BUY' 

                          ? 'bg-blue-500/20 border border-blue-500 text-blue-400' 

                          : isDarkMode ? 'bg-[#1a1a1a] border border-gray-600 text-gray-400 hover:border-blue-500/50' : 'bg-gray-50 border border-gray-300 text-gray-600 hover:border-blue-500/50'

                      }`}

                    >

                      Buy Side

                    </button>

                  </div>



                  {/* Volume */}

                  <div className="mb-3">

                    <label className={`text-xs mb-1 block ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Volume</label>

                    <div className={`flex items-center rounded border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700' : 'bg-gray-50 border-gray-300'}`}>

                      <button onClick={() => setVolume((Math.max(0.01, parseFloat(volume) - 0.01)).toFixed(2))} className={`px-3 py-2 border-r ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'}`}>

                        <Minus size={14} />

                      </button>

                      <input

                        type="text"

                        value={volume}

                        onChange={(e) => setVolume(e.target.value)}

                        className={`flex-1 bg-transparent text-center text-sm font-medium focus:outline-none py-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}

                      />

                      <button onClick={() => setVolume((parseFloat(volume) + 0.01).toFixed(2))} className={`px-3 py-2 border-l ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'}`}>

                        <Plus size={14} />

                      </button>

                    </div>

                    <div className="text-right text-gray-500 text-[10px] mt-1">{volume} lot</div>

                  </div>



                  {/* Leverage */}

                  <div className="mb-3">

                    <div className={`text-xs mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Leverage (Max: {account?.leverage || '1:100'})</div>

                    <div className="flex gap-2">

                      <select 

                        value={leverage}

                        onChange={(e) => setLeverage(e.target.value)}

                        className={`flex-1 rounded px-3 py-2 text-sm focus:outline-none border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}

                      >

                        {(() => {

                          const maxLev = parseInt((account?.leverage || '1:100').replace('1:', '')) || 100

                          const options = [50, 100, 200, 500, 1000, 2000, 5000].filter(l => l <= maxLev)

                          if (!options.includes(maxLev)) options.push(maxLev)

                          return options.sort((a, b) => a - b).map(l => (

                            <option key={l} value={`1:${l}`}>1:{l}</option>

                          ))

                        })()}

                      </select>

                      <div className={`rounded px-3 py-2 text-green-500 text-sm font-medium border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700' : 'bg-gray-50 border-gray-300'}`}>

                        ${(() => {

                          const leverageNum = parseInt(leverage.replace('1:', '')) || 100

                          const lpM = livePrices[selectedInstrument.symbol]

                          const rbM = lpM?.bid ?? selectedInstrument.bid

                          const raM = lpM?.ask ?? selectedInstrument.ask

                          const qM = getDisplayQuotes(selectedInstrument.symbol, rbM, raM)

                          // Currency-aware margin (USD-quoted / USD-base / cross pairs) using live rates
                          const getQuote = (sym) => livePrices[sym] || instruments.find(i => i.symbol === sym) || null

                          const margin = computeMarginUsd(selectedInstrument.symbol, parseFloat(volume || 0), qM.ask || 0, leverageNum, getQuote)

                          return margin.toFixed(2)

                        })()}

                      </div>

                    </div>

                    <div className="text-gray-500 text-[10px] mt-1">

                      Margin Required | Free: ${accountSummary.freeMargin?.toFixed(2) || '0.00'}

                    </div>

                    <div className="text-blue-400 text-[10px] mt-0.5">

                      Buying Power: ${(() => {

                        const leverageNum = parseInt(leverage.replace('1:', '')) || 100

                        return ((accountSummary.equity || 0) * leverageNum).toLocaleString()

                      })()}

                    </div>

                  </div>



                  {/* Take Profit */}

                  <div className="mb-2">

                    <button 

                      onClick={() => setShowTakeProfit(!showTakeProfit)}

                      className="flex items-center justify-between w-full py-2"

                    >

                      <span className="text-green-500 text-sm">Take profit</span>

                      <Plus size={16} className={`text-green-500 transition-transform ${showTakeProfit ? 'rotate-45' : ''}`} />

                    </button>

                    {showTakeProfit && (

                      <div className="flex gap-2 mt-1">

                        <input

                          type="text"

                          value={takeProfit}

                          onChange={(e) => setTakeProfit(e.target.value)}

                          placeholder="Price"

                          className={`flex-1 rounded px-3 py-2 text-sm focus:outline-none focus:border-green-500 border border-green-500/50 ${isDarkMode ? 'bg-[#1a1a1a] text-white' : 'bg-gray-50 text-gray-900'}`}

                        />

                        <input

                          type="text"

                          placeholder="Pips"

                          className={`w-16 rounded px-2 py-2 text-sm focus:outline-none border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}

                        />

                      </div>

                    )}

                  </div>



                  {/* Stop Loss */}

                  <div className="mb-3">

                    <button 

                      onClick={() => setShowStopLoss(!showStopLoss)}

                      className="flex items-center justify-between w-full py-2"

                    >

                      <span className="text-red-500 text-sm">Stop loss</span>

                      <Plus size={16} className={`text-red-500 transition-transform ${showStopLoss ? 'rotate-45' : ''}`} />

                    </button>

                    {showStopLoss && (

                      <div className="flex gap-2 mt-1">

                        <input

                          type="text"

                          value={stopLoss}

                          onChange={(e) => setStopLoss(e.target.value)}

                          placeholder="Price"

                          className={`flex-1 rounded px-3 py-2 text-sm focus:outline-none focus:border-red-500 border border-red-500/50 ${isDarkMode ? 'bg-[#1a1a1a] text-white' : 'bg-gray-50 text-gray-900'}`}

                        />

                        <input

                          type="text"

                          placeholder="Pips"

                          className={`w-16 rounded px-2 py-2 text-sm focus:outline-none border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}

                        />

                      </div>

                    )}

                  </div>



                  {/* Trading Charges */}

                  <div className={`rounded p-3 mb-3 ${isDarkMode ? 'bg-[#1a1a1a]' : 'bg-gray-50 border border-gray-200'}`}>

                    <div className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Trading Charges</div>

                    <div className="flex justify-between text-xs mb-1">

                      <span className="text-gray-400">Spread</span>

                      <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>10 pips</span>

                    </div>

                    <div className="flex justify-between text-xs">

                      <span className="text-gray-400">Commission</span>

                      <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>$0.10 ($10/lot)</span>

                    </div>

                  </div>



                  <div className="flex justify-between items-center mb-2">

                    <span className="text-gray-400 text-xs">Margin Required</span>

                    <span className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>${calculateMargin()}</span>

                  </div>

                </div>



                {/* Error/Success Messages */}

                {tradeError && (

                  <div className="mx-3 mb-2 p-2 bg-red-500/20 border border-red-500 rounded text-red-400 text-xs text-center">

                    {tradeError}

                  </div>

                )}

                {tradeSuccess && (

                  <div className="mx-3 mb-2 p-2 bg-green-500/20 border border-green-500 rounded text-green-400 text-xs text-center">

                    {tradeSuccess}

                  </div>

                )}



                <div className={`p-3 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

                  <button

                    onClick={() => executeMarketOrder(selectedSide)}

                    disabled={isExecutingTrade || !marketOpen}

                    title={!marketOpen ? (marketClosedMsg || 'Market closed') : ''}

                    className={`w-full py-3 rounded font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${

                      selectedSide === 'BUY'

                        ? 'bg-blue-600/20 border border-blue-600 hover:bg-blue-600/30 text-blue-400'

                        : 'bg-red-600/20 border border-red-600 hover:bg-red-600/30 text-red-400'

                    }`}

                  >

                    {isExecutingTrade ? 'Executing...' : (!marketOpen ? 'Market Closed (Weekend)' : `Open ${selectedSide} Order`)}

                  </button>

                  <div className="text-center text-gray-500 text-xs mt-2">

                    {(() => {

                      const lp = livePrices[selectedInstrument.symbol]

                      const q = getDisplayQuotes(selectedInstrument.symbol, lp?.bid ?? selectedInstrument.bid, lp?.ask ?? selectedInstrument.ask)

                      const px = selectedSide === 'BUY' ? q.ask : q.bid

                      return `${volume} lots @ ${formatTradePrice(selectedInstrument.symbol, px)}`

                    })()}

                  </div>

                </div>

              </>

            ) : (

              <>

                <div className={`p-3 flex-1 overflow-y-auto ${!isDarkMode ? 'light-scrollbar' : ''}`}>

                  {/* Order Type */}

                  <div className="mb-3">

                    <div className={`text-xs mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Order type</div>

                    <div className="grid grid-cols-2 gap-2">

                      {['BUY LIMIT', 'SELL LIMIT', 'BUY STOP', 'SELL STOP'].map(type => (

                        <button

                          key={type}

                          onClick={() => setPendingOrderType(type)}

                          className={`py-2 rounded text-xs font-medium transition-colors ${

                            pendingOrderType === type

                              ? type.includes('BUY') 

                                ? 'bg-blue-600 text-white' 

                                : 'bg-red-600 text-white'

                              : type.includes('BUY')

                                ? isDarkMode ? 'bg-[#1a1a1a] border border-blue-500/30 text-blue-400 hover:bg-blue-500/10' : 'bg-gray-50 border border-blue-500/30 text-blue-600 hover:bg-blue-500/10'

                                : isDarkMode ? 'bg-[#1a1a1a] border border-red-500/30 text-red-400 hover:bg-red-500/10' : 'bg-gray-50 border border-red-500/30 text-red-600 hover:bg-red-500/10'

                          }`}

                        >

                          {type}

                        </button>

                      ))}

                    </div>

                  </div>



                  {/* Entry Price */}

                  <div className="mb-3">

                    <div className={`text-xs mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Entry price</div>

                    <input

                      type="text"

                      value={entryPrice}

                      onChange={(e) => setEntryPrice(e.target.value)}

                      placeholder="Enter price"

                      className={`w-full rounded px-3 py-2.5 text-sm focus:outline-none border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700 text-white focus:border-gray-600' : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-gray-400'}`}

                    />

                  </div>



                  {/* Order Volume */}

                  <div className="mb-3">

                    <div className={`text-xs mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Order volume</div>

                    <div className={`flex items-center rounded border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700' : 'bg-gray-50 border-gray-300'}`}>

                      <input

                        type="text"

                        value={volume}

                        onChange={(e) => setVolume(e.target.value)}

                        className={`flex-1 bg-transparent text-center text-sm font-medium focus:outline-none py-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}

                      />

                      <button onClick={() => setVolume((Math.max(0.01, parseFloat(volume) - 0.01)).toFixed(2))} className={`px-3 py-2 border-l ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'}`}>

                        <Minus size={14} />

                      </button>

                      <button onClick={() => setVolume((parseFloat(volume) + 0.01).toFixed(2))} className={`px-3 py-2 border-l ${isDarkMode ? 'text-gray-400 hover:text-white border-gray-700' : 'text-gray-600 hover:text-gray-900 border-gray-300'}`}>

                        <Plus size={14} />

                      </button>

                    </div>

                  </div>



                  {/* Leverage */}

                  <div className="mb-3">

                    <div className={`text-xs mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Leverage (Max: {account?.leverage || '1:100'})</div>

                    <div className="flex gap-2">

                      <select 

                        value={leverage}

                        onChange={(e) => setLeverage(e.target.value)}

                        className={`flex-1 rounded px-3 py-2 text-sm focus:outline-none border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}

                      >

                        {(() => {

                          const maxLev = parseInt((account?.leverage || '1:100').replace('1:', '')) || 100

                          const options = [50, 100, 200, 500, 1000, 2000, 5000].filter(l => l <= maxLev)

                          if (!options.includes(maxLev)) options.push(maxLev)

                          return options.sort((a, b) => a - b).map(l => (

                            <option key={l} value={`1:${l}`}>1:{l}</option>

                          ))

                        })()}

                      </select>

                      <div className={`rounded px-3 py-2 text-green-500 text-sm border ${isDarkMode ? 'bg-[#1a1a1a] border-gray-700' : 'bg-gray-50 border-gray-300'}`}>$0</div>

                    </div>

                    <div className="text-gray-500 text-[10px] mt-1">Trading power: $0.00 × 100 = $0</div>

                  </div>



                  {/* Take Profit */}

                  <div className="mb-2">

                    <button 

                      onClick={() => setShowTakeProfit(!showTakeProfit)}

                      className="flex items-center justify-between w-full py-2"

                    >

                      <span className="text-green-500 text-sm">Take profit</span>

                      <Plus size={16} className={`text-green-500 transition-transform ${showTakeProfit ? 'rotate-45' : ''}`} />

                    </button>

                    {showTakeProfit && (

                      <div className="flex gap-2 mt-1">

                        <input

                          type="text"

                          value={takeProfit}

                          onChange={(e) => setTakeProfit(e.target.value)}

                          placeholder="Price"

                          className={`flex-1 rounded px-3 py-2 text-sm focus:outline-none border border-green-500/50 focus:border-green-500 ${isDarkMode ? 'bg-[#1a1a1a] text-white' : 'bg-gray-50 text-gray-900'}`}

                        />

                      </div>

                    )}

                  </div>



                  {/* Stop Loss */}

                  <div className="mb-3">

                    <button 

                      onClick={() => setShowStopLoss(!showStopLoss)}

                      className="flex items-center justify-between w-full py-2"

                    >

                      <span className="text-red-500 text-sm">Stop loss</span>

                      <Plus size={16} className={`text-red-500 transition-transform ${showStopLoss ? 'rotate-45' : ''}`} />

                    </button>

                    {showStopLoss && (

                      <div className="flex gap-2 mt-1">

                        <input

                          type="text"

                          value={stopLoss}

                          onChange={(e) => setStopLoss(e.target.value)}

                          placeholder="Price"

                          className={`flex-1 rounded px-3 py-2 text-sm focus:outline-none border border-red-500/50 focus:border-red-500 ${isDarkMode ? 'bg-[#1a1a1a] text-white' : 'bg-gray-50 text-gray-900'}`}

                        />

                      </div>

                    )}

                  </div>



                  {/* Trading Charges */}

                  <div className={`rounded p-3 mb-3 ${isDarkMode ? 'bg-[#1a1a1a]' : 'bg-gray-50 border border-gray-200'}`}>

                    <div className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Trading Charges</div>

                    <div className="flex justify-between text-xs mb-1">

                      <span className="text-gray-400">Spread</span>

                      <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>10 pips</span>

                    </div>

                    <div className="flex justify-between text-xs">

                      <span className="text-gray-400">Commission</span>

                      <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>$0.10 ($10/lot)</span>

                    </div>

                  </div>

                </div>



                {/* Error/Success Messages for Pending */}

                {tradeError && (

                  <div className="mx-3 mb-2 p-2 bg-red-500/20 border border-red-500 rounded text-red-400 text-xs text-center">

                    {tradeError}

                  </div>

                )}

                {tradeSuccess && (

                  <div className="mx-3 mb-2 p-2 bg-green-500/20 border border-green-500 rounded text-green-400 text-xs text-center">

                    {tradeSuccess}

                  </div>

                )}



                <div className={`p-3 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>

                  <button

                    onClick={executePendingOrder}

                    disabled={isExecutingTrade || !marketOpen}

                    title={!marketOpen ? (marketClosedMsg || 'Market closed') : ''}

                    className="w-full bg-blue-600/20 border border-blue-600 hover:bg-blue-600/30 text-blue-400 py-3 rounded font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"

                  >

                    {isExecutingTrade ? 'Placing...' : (!marketOpen ? 'Market Closed (Weekend)' : `Place ${pendingOrderType}`)}

                  </button>

                  <div className="text-center text-gray-500 text-xs mt-2">

                    {volume} lots @ {entryPrice || '--.--'}

                  </div>

                </div>

              </>

            )}

          </div>

        )}

        </div>



        {/* Bottom Status Bar */}

        <footer className={`h-6 border-t flex items-center px-2 sm:px-3 text-[10px] sm:text-xs shrink-0 overflow-x-auto ${isDarkMode ? 'bg-black border-gray-800' : 'bg-white border-gray-200'}`}>

          <span className={`font-medium shrink-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{selectedInstrument.symbol}</span>

          <span className="text-gray-500 ml-2 sm:ml-4 shrink-0">Bal: <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>${accountSummary.balance?.toFixed(2) || '0.00'}</span></span>

          {!isMobile && (

            <>

              <span className="text-gray-500 ml-4 shrink-0">Credit: <span className="text-purple-400">${accountSummary.credit?.toFixed(2) || '0.00'}</span></span>

              <span className="text-gray-500 ml-4 shrink-0">Eq: <span className={accountSummary.floatingPnl >= 0 ? 'text-green-500' : 'text-red-500'}>${accountSummary.equity?.toFixed(2) || '0.00'}</span></span>

              <span className="text-gray-500 ml-4 shrink-0">Margin: <span className="text-yellow-500">${accountSummary.usedMargin?.toFixed(2) || '0.00'}</span></span>

              <span className="text-gray-500 ml-4 shrink-0">Free: <span className={accountSummary.freeMargin >= 0 ? 'text-blue-400' : 'text-red-500'}>${accountSummary.freeMargin?.toFixed(2) || '0.00'}</span></span>

            </>

          )}

          <div className="flex-1 flex justify-center">
            <span className="text-gray-500 shrink-0">P/L: <span className={liveTotalPnl >= 0 ? 'text-green-500' : 'text-red-500'}>{liveTotalPnl >= 0 ? '+' : '-'}${Math.abs(liveTotalPnl).toFixed(2)}</span></span>
          </div>

          {!isMobile && <span className="text-gray-400 shrink-0">{accountType === 'challenge' ? 'Challenge' : (account?.accountTypeId?.name || 'Account')} - {account?.accountId}</span>}

          <span className="text-green-500 ml-2 sm:ml-3 shrink-0 flex items-center gap-1">

            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>

            Live

          </span>

        </footer>

      </div>



      {/* iOS-Style Modify SL/TP Modal */}

      {showModifyModal && selectedTradeForModify && (

        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={() => setShowModifyModal(false)}>

          <div className="w-full sm:w-96 bg-[#1c1c1e] sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>

            {/* Header */}

            <div className="px-4 py-3 border-b border-gray-700/50 text-center">

              <h3 className="text-white font-semibold text-lg">Modify Trade</h3>

              <p className="text-gray-400 text-sm mt-1">

                {selectedTradeForModify.symbol} • {selectedTradeForModify.side} • {selectedTradeForModify.quantity} lots

              </p>

            </div>

            

            {/* Content */}

            <div className="p-4 space-y-4">

              {/* Error/Success messages */}

              {tradeError && (

                <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">

                  {tradeError}

                </div>

              )}

              {tradeSuccess && (

                <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-3 text-green-400 text-sm">

                  {tradeSuccess}

                </div>

              )}

              <div>

                <label className="text-gray-400 text-sm mb-2 block">Stop Loss</label>

                <input

                  type="number"

                  value={modifySL}

                  onChange={(e) => setModifySL(e.target.value)}

                  placeholder="Enter stop loss price"

                  step="0.00001"

                  className="w-full bg-[#2c2c2e] border border-gray-600 rounded-xl px-4 py-3 text-white text-base focus:outline-none focus:border-red-500 transition-colors"

                />

              </div>

              <div>

                <label className="text-gray-400 text-sm mb-2 block">Take Profit</label>

                <input

                  type="number"

                  value={modifyTP}

                  onChange={(e) => setModifyTP(e.target.value)}

                  placeholder="Enter take profit price"

                  step="0.00001"

                  className="w-full bg-[#2c2c2e] border border-gray-600 rounded-xl px-4 py-3 text-white text-base focus:outline-none focus:border-green-500 transition-colors"

                />

              </div>

            </div>



            {/* Actions */}

            <div className="border-t border-gray-700/50">

              <button

                type="button"

                onClick={async (e) => {

                  e.preventDefault()

                  e.stopPropagation()

                  console.log('Save Changes clicked, trade:', selectedTradeForModify?._id)

                  await handleModifyTrade()

                }}

                className="w-full py-4 text-blue-500 font-semibold text-lg hover:bg-[#2c2c2e] transition-colors cursor-pointer active:bg-[#3c3c3e]"

              >

                Save Changes

              </button>

            </div>

            <div className="border-t border-gray-700/50">

              <button

                onClick={() => setShowModifyModal(false)}

                className="w-full py-4 text-gray-400 font-medium text-lg hover:bg-[#2c2c2e] transition-colors"

              >

                Cancel

              </button>

            </div>

          </div>

        </div>

      )}



      {/* iOS-Style Close Trade Confirmation Modal */}

      {showCloseModal && selectedTradeForClose && (

        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">

          <div className="w-full sm:w-80 bg-[#1c1c1e] sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up">

            {/* Header */}

            <div className="px-4 py-4 text-center">

              <h3 className="text-white font-semibold text-lg">Close Trade?</h3>

              <p className="text-gray-400 text-sm mt-2">

                {selectedTradeForClose.symbol} • {selectedTradeForClose.side} • {selectedTradeForClose.quantity} lots

              </p>

              <p className="text-gray-500 text-xs mt-1">

                This action cannot be undone

              </p>

            </div>



            {/* Actions */}

            <div className="border-t border-gray-700/50">

              <button

                onClick={handleConfirmClose}

                className="w-full py-4 text-red-500 font-semibold text-lg hover:bg-[#2c2c2e] transition-colors"

              >

                Close Trade

              </button>

            </div>

            {/* Close All Options */}

            {openTrades.length > 1 && (

              <>

                <div className="border-t border-gray-700/50">

                  <button

                    onClick={() => { setShowCloseModal(false); handleCloseAllTrades('all'); }}

                    className="w-full py-4 text-orange-500 font-medium text-lg hover:bg-[#2c2c2e] transition-colors"

                  >

                    Close All ({openTrades.length})

                  </button>

                </div>

                <div className="border-t border-gray-700/50">

                  <button

                    onClick={() => { setShowCloseModal(false); handleCloseAllTrades('profit'); }}

                    className="w-full py-4 text-green-500 font-medium text-lg hover:bg-[#2c2c2e] transition-colors"

                  >

                    Close Profit

                  </button>

                </div>

                <div className="border-t border-gray-700/50">

                  <button

                    onClick={() => { setShowCloseModal(false); handleCloseAllTrades('loss'); }}

                    className="w-full py-4 text-red-400 font-medium text-lg hover:bg-[#2c2c2e] transition-colors"

                  >

                    Close Loss

                  </button>

                </div>

              </>

            )}

            <div className="border-t border-gray-700/50">

              <button

                onClick={() => setShowCloseModal(false)}

                className="w-full py-4 text-blue-500 font-medium text-lg hover:bg-[#2c2c2e] transition-colors"

              >

                Cancel

              </button>

            </div>

          </div>

        </div>

      )}



      {/* iOS-Style Close All Trades Confirmation Modal */}

      {showCloseAllModal && (

        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">

          <div className="w-full sm:w-80 bg-[#1c1c1e] sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up">

            {/* Header */}

            <div className="px-4 py-4 text-center">

              <h3 className="text-white font-semibold text-lg">

                {closeAllType === 'all' && 'Close All Trades?'}

                {closeAllType === 'profit' && 'Close Winning Trades?'}

                {closeAllType === 'loss' && 'Close Losing Trades?'}

              </h3>

              <p className="text-gray-400 text-sm mt-2">

                {closeAllType === 'all' && `This will close all ${openTrades.length} open trade(s)`}

                {closeAllType === 'profit' && 'This will close all trades currently in profit'}

                {closeAllType === 'loss' && 'This will close all trades currently in loss'}

              </p>

              <p className="text-gray-500 text-xs mt-1">

                This action cannot be undone

              </p>

            </div>



            {/* Actions */}

            <div className="border-t border-gray-700/50">

              <button

                onClick={confirmCloseAll}

                className={`w-full py-4 font-semibold text-lg hover:bg-[#2c2c2e] transition-colors ${

                  closeAllType === 'profit' ? 'text-green-500' : closeAllType === 'loss' ? 'text-red-500' : 'text-orange-500'

                }`}

              >

                {closeAllType === 'all' && 'Close All'}

                {closeAllType === 'profit' && 'Close Winners'}

                {closeAllType === 'loss' && 'Close Losers'}

              </button>

            </div>

            <div className="border-t border-gray-700/50">

              <button

                onClick={() => setShowCloseAllModal(false)}

                className="w-full py-4 text-blue-500 font-medium text-lg hover:bg-[#2c2c2e] transition-colors"

              >

                Cancel

              </button>

            </div>

          </div>

        </div>

      )}



      {/* Kill Switch Modal */}

      {showKillSwitchModal && (

        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">

          <div className="w-full sm:w-96 bg-[#1c1c1e] sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up">

            {/* Header */}

            <div className="px-4 py-4 text-center border-b border-gray-700/50">

              <div className="text-4xl mb-2">🛑</div>

              <h3 className="text-white text-lg font-semibold">Kill Switch</h3>

              <p className="text-gray-400 text-sm mt-1">

                Block all trading for a set period to prevent emotional decisions

              </p>

            </div>

            

            {/* Duration Selection */}

            <div className="p-4 space-y-4">

              {/* Value Input */}

              <div>

                <label className="text-gray-400 text-xs mb-2 block">Duration</label>

                <div className="flex gap-2">

                  <input

                    type="number"

                    min="1"

                    max="999"

                    value={killSwitchDuration.value}

                    onChange={(e) => setKillSwitchDuration(prev => ({ ...prev, value: parseInt(e.target.value) || 1 }))}

                    className="flex-1 bg-[#2c2c2e] text-white px-3 py-2 rounded-lg text-center text-lg font-mono"

                  />

                  <select

                    value={killSwitchDuration.unit}

                    onChange={(e) => setKillSwitchDuration(prev => ({ ...prev, unit: e.target.value }))}

                    className="bg-[#2c2c2e] text-white px-3 py-2 rounded-lg"

                  >

                    <option value="seconds">Seconds</option>

                    <option value="minutes">Minutes</option>

                    <option value="hours">Hours</option>

                    <option value="days">Days</option>

                  </select>

                </div>

              </div>

              

              {/* Quick Select Buttons */}

              <div>

                <label className="text-gray-400 text-xs mb-2 block">Quick Select</label>

                <div className="grid grid-cols-4 gap-2">

                  <button

                    onClick={() => setKillSwitchDuration({ value: 30, unit: 'seconds' })}

                    className="bg-[#2c2c2e] hover:bg-[#3c3c3e] text-white py-2 rounded-lg text-xs"

                  >

                    30s

                  </button>

                  <button

                    onClick={() => setKillSwitchDuration({ value: 5, unit: 'minutes' })}

                    className="bg-[#2c2c2e] hover:bg-[#3c3c3e] text-white py-2 rounded-lg text-xs"

                  >

                    5m

                  </button>

                  <button

                    onClick={() => setKillSwitchDuration({ value: 30, unit: 'minutes' })}

                    className="bg-[#2c2c2e] hover:bg-[#3c3c3e] text-white py-2 rounded-lg text-xs"

                  >

                    30m

                  </button>

                  <button

                    onClick={() => setKillSwitchDuration({ value: 1, unit: 'hours' })}

                    className="bg-[#2c2c2e] hover:bg-[#3c3c3e] text-white py-2 rounded-lg text-xs"

                  >

                    1h

                  </button>

                  <button

                    onClick={() => setKillSwitchDuration({ value: 4, unit: 'hours' })}

                    className="bg-[#2c2c2e] hover:bg-[#3c3c3e] text-white py-2 rounded-lg text-xs"

                  >

                    4h

                  </button>

                  <button

                    onClick={() => setKillSwitchDuration({ value: 12, unit: 'hours' })}

                    className="bg-[#2c2c2e] hover:bg-[#3c3c3e] text-white py-2 rounded-lg text-xs"

                  >

                    12h

                  </button>

                  <button

                    onClick={() => setKillSwitchDuration({ value: 1, unit: 'days' })}

                    className="bg-[#2c2c2e] hover:bg-[#3c3c3e] text-white py-2 rounded-lg text-xs"

                  >

                    1d

                  </button>

                  <button

                    onClick={() => setKillSwitchDuration({ value: 7, unit: 'days' })}

                    className="bg-[#2c2c2e] hover:bg-[#3c3c3e] text-white py-2 rounded-lg text-xs"

                  >

                    7d

                  </button>

                </div>

              </div>

              

              {/* Warning */}

              <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">

                <p className="text-orange-400 text-xs">

                  ⚠️ Once activated, you won't be able to open new trades until the timer expires. You can still close existing trades.

                </p>

              </div>

            </div>

            

            {/* Actions */}

            <div className="border-t border-gray-700/50">

              <button

                onClick={activateKillSwitch}

                className="w-full py-4 text-red-500 font-semibold text-lg hover:bg-[#2c2c2e] transition-colors"

              >

                Activate Kill Switch

              </button>

            </div>

            <div className="border-t border-gray-700/50">

              <button

                onClick={() => setShowKillSwitchModal(false)}

                className="w-full py-4 text-blue-500 font-medium text-lg hover:bg-[#2c2c2e] transition-colors"

              >

                Cancel

              </button>

            </div>

          </div>

        </div>

      )}



      <style>{`

        @keyframes slide-up {

          from {

            transform: translateY(100%);

            opacity: 0;

          }

          to {

            transform: translateY(0);

            opacity: 1;

          }

        }

        .animate-slide-up {

          animation: slide-up 0.3s ease-out;

        }

      `}</style>

      {/* KYC gate for demo (and any) accounts — shown when placing an order without approved KYC */}
      <KycTradeRequiredModal
        open={showKycModal}
        onClose={() => setShowKycModal(false)}
        isDarkMode={isDarkMode}
      />

    </div>

  )

}



export default TradingPage

