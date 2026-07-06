import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import AdminLayout from '../components/AdminLayout'
import { 
  DollarSign,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  RefreshCw,
  Search,
  User,
  TrendingUp,
  Moon
} from 'lucide-react'
import { API_URL } from '../config/api'

const INSTRUMENT_SEGMENT_ORDER = ['Forex', 'Metals', 'Crypto', 'Commodities']

const FOREX_MAJOR_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD']
const FOREX_MAJOR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD']
const FOREX_SUBCATEGORY_ORDER = ['Major', 'Minor', 'Exotic']

function classifyForexPair(symbol) {
  const clean = String(symbol || '').replace(/[\/\-_]/g, '').toUpperCase()
  if (FOREX_MAJOR_PAIRS.includes(clean)) return 'Major'
  if (clean.length === 6) {
    const base = clean.substring(0, 3)
    const quote = clean.substring(3, 6)
    if (FOREX_MAJOR_CURRENCIES.includes(base) && FOREX_MAJOR_CURRENCIES.includes(quote)) {
      return 'Minor'
    }
  }
  return 'Exotic'
}

function sortCategories(categories) {
  return [...categories].sort((a, b) => {
    const ia = INSTRUMENT_SEGMENT_ORDER.indexOf(a)
    const ib = INSTRUMENT_SEGMENT_ORDER.indexOf(b)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
}

function getInstrumentOptGroups(instruments, segmentFilter, forexSubcategoryFilter = 'all') {
  if (!instruments?.length) return []
  const cats = segmentFilter
    ? [segmentFilter].filter((c) => instruments.some((i) => i.category === c))
    : sortCategories([...new Set(instruments.map((i) => i.category))])

  const groups = []
  for (const category of cats) {
    const items = instruments
      .filter((i) => i.category === category)
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
    if (items.length === 0) continue

    if (category === 'Forex') {
      const buckets = { Major: [], Minor: [], Exotic: [] }
      for (const item of items) {
        buckets[classifyForexPair(item.symbol)].push(item)
      }
      // Keep Major sorted in the canonical pair order, then alphabetical for others
      buckets.Major.sort((a, b) => {
        const ia = FOREX_MAJOR_PAIRS.indexOf(a.symbol.replace(/[\/\-_]/g, '').toUpperCase())
        const ib = FOREX_MAJOR_PAIRS.indexOf(b.symbol.replace(/[\/\-_]/g, '').toUpperCase())
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
      })

      const subsToShow = forexSubcategoryFilter && forexSubcategoryFilter !== 'all'
        ? [forexSubcategoryFilter]
        : FOREX_SUBCATEGORY_ORDER
      for (const sub of subsToShow) {
        if (buckets[sub]?.length > 0) {
          groups.push({ category: `Forex — ${sub}`, items: buckets[sub] })
        }
      }
    } else {
      groups.push({ category, items })
    }
  }
  return groups
}

const AdminForexCharges = () => {
  const [charges, setCharges] = useState([])
  const [instruments, setInstruments] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalType, setModalType] = useState(null) // 'commission', 'spread', 'swap'
  const [editingCharge, setEditingCharge] = useState(null)
  const [users, setUsers] = useState([])
  const [accountTypes, setAccountTypes] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedAccountType, setSelectedAccountType] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [forexSubcategory, setForexSubcategory] = useState('Major') // 'Major' | 'Minor' | 'Exotic'
  const [form, setForm] = useState({
    level: 'SEGMENT',
    segment: 'Forex',
    instrumentSymbol: '',
    userId: '',
    accountTypeId: '',
    spreadType: 'FIXED',
    spreadValue: 0,
    commissionType: 'PER_LOT',
    commissionValue: 0,
    commissionOnBuy: true,
    commissionOnSell: true,
    commissionOnClose: false,
    swapLong: 0,
    swapShort: 0
  })

  useEffect(() => {
    fetchCharges()
    fetchUsers()
    fetchAccountTypes()
    fetchInstruments()
  }, [])

  useEffect(() => {
    if (form.segment === 'Forex' && !['Major', 'Minor', 'Exotic'].includes(forexSubcategory)) {
      setForexSubcategory('Major')
    }
  }, [form.segment])

  const fetchInstruments = async () => {
    try {
      const res = await fetch(`${API_URL}/prices/instruments`, { cache: 'no-store' })
      const data = await res.json()
      if (data.success && Array.isArray(data.instruments)) {
        setInstruments(data.instruments)
      }
    } catch (error) {
      console.error('Error fetching instruments:', error)
    }
  }

  const fetchAccountTypes = async () => {
    try {
      const res = await fetch(`${API_URL}/account-types/all`)
      const data = await res.json()
      setAccountTypes(data.accountTypes || [])
    } catch (error) {
      console.error('Error fetching account types:', error)
    }
  }

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/users`)
      const data = await res.json()
      if (data.success) {
        setUsers(data.users || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchCharges = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/charges`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      })
      const data = await res.json()
      if (data.success) {
        setCharges(data.charges || [])
      }
    } catch (error) {
      console.error('Error fetching charges:', error)
    }
    setLoading(false)
  }

  const deriveChargeLevel = (f) => {
    if (f.userId) return 'USER'
    if (f.instrumentSymbol) return 'INSTRUMENT'
    if (f.accountTypeId) return 'ACCOUNT_TYPE'
    if (f.segment) return 'SEGMENT'
    return 'GLOBAL'
  }

  const handleSave = async () => {
    try {
      const url = editingCharge
        ? `${API_URL}/charges/${editingCharge._id}`
        : `${API_URL}/charges`
      const method = editingCharge ? 'PUT' : 'POST'

      const payload = { ...form, level: deriveChargeLevel(form) }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (data.success) {
        toast.success(editingCharge ? 'Updated!' : 'Created!')
        if (data.charge) {
          setCharges((prev) => {
            const id = data.charge._id
            const rest = prev.filter((c) => c._id !== id)
            return [data.charge, ...rest]
          })
        }
        setModalType(null)
        setEditingCharge(null)
        resetForm()
        fetchCharges()
      } else {
        toast.error(data.message || 'Error saving')
      }
    } catch (error) {
      toast.error('Error saving')
    }
  }

  const handleDelete = (chargeId) => {
    setDeleteConfirmId(chargeId)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/charges/${deleteConfirmId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        toast.success('Charge deleted!')
        fetchCharges()
      } else {
        toast.error(data.message || 'Error deleting charge')
      }
    } catch (error) {
      toast.error('Error deleting charge')
    }
    setDeleting(false)
    setDeleteConfirmId(null)
  }

  const openEditModal = (charge, type) => {
    setEditingCharge(charge)
    setForm({
      level: charge.level || 'SEGMENT',
      segment: charge.segment || 'Forex',
      instrumentSymbol: charge.instrumentSymbol || '',
      userId: charge.userId?._id || charge.userId || '',
      accountTypeId: charge.accountTypeId?._id || charge.accountTypeId || '',
      spreadType: charge.spreadType || 'FIXED',
      spreadValue: charge.spreadValue || 0,
      commissionType: charge.commissionType || 'PER_LOT',
      commissionValue: charge.commissionValue || 0,
      commissionOnBuy: charge.commissionOnBuy !== false,
      commissionOnSell: charge.commissionOnSell !== false,
      commissionOnClose: charge.commissionOnClose || false,
      swapLong: charge.swapLong || 0,
      swapShort: charge.swapShort || 0
    })
    if (charge.level === 'USER' && charge.userId) {
      const user = users.find(u => u._id === (charge.userId?._id || charge.userId))
      setSelectedUser(user || null)
    } else {
      setSelectedUser(null)
    }
    if (charge.level === 'ACCOUNT_TYPE' && charge.accountTypeId) {
      const accType = accountTypes.find(a => a._id === (charge.accountTypeId?._id || charge.accountTypeId))
      setSelectedAccountType(accType || null)
    } else {
      setSelectedAccountType(null)
    }
    // Auto-select Forex sub-category so the editing instrument stays visible in the dropdown
    if (charge.segment === 'Forex' && charge.instrumentSymbol) {
      setForexSubcategory(classifyForexPair(charge.instrumentSymbol))
    } else {
      setForexSubcategory('Major')
    }
    setModalType(type)
  }

  const resetForm = () => {
    setForm({
      level: 'SEGMENT',
      segment: 'Forex',
      instrumentSymbol: '',
      userId: '',
      accountTypeId: '',
      spreadType: 'FIXED',
      spreadValue: 0,
      commissionType: 'PER_LOT',
      commissionValue: 0,
      commissionOnBuy: true,
      commissionOnSell: true,
      commissionOnClose: false,
      swapLong: 0,
      swapShort: 0
    })
    setSelectedUser(null)
    setSelectedAccountType(null)
    setUserSearch('')
    setForexSubcategory('Major')
  }

  const selectUser = (user) => {
    setSelectedUser(user)
    setForm({ ...form, userId: user._id })
    setShowUserDropdown(false)
    setUserSearch('')
  }

  const filteredUsers = users.filter(user => {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase()
    const searchLower = userSearch.toLowerCase()
    return fullName.includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower) ||
      user.phone?.includes(userSearch) ||
      user._id?.includes(userSearch)
  })

  const instrumentSelectClass =
    'w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm'

  const handleInstrumentSymbolChange = (e) => {
    const instrumentSymbol = e.target.value
    setForm((prev) => ({
      ...prev,
      instrumentSymbol,
      level: instrumentSymbol
        ? 'INSTRUMENT'
        : prev.accountTypeId
          ? 'ACCOUNT_TYPE'
          : prev.segment
            ? 'SEGMENT'
            : 'GLOBAL'
    }))
  }

  const handleSubcategoryChange = (sub) => {
    setForexSubcategory(sub)
    // If the currently selected instrument no longer belongs to the chosen sub-bucket, clear it
    if (form.instrumentSymbol) {
      const inst = instruments.find((i) => i.symbol === form.instrumentSymbol)
      if (inst?.category === 'Forex' && classifyForexPair(form.instrumentSymbol) !== sub) {
        setForm((prev) => ({
          ...prev,
          instrumentSymbol: '',
          level: prev.accountTypeId ? 'ACCOUNT_TYPE' : prev.segment ? 'SEGMENT' : 'GLOBAL'
        }))
      }
    }
  }

  const FOREX_SUB_PILLS = [
    {
      key: 'Major',
      label: 'Major',
      active: 'bg-gradient-to-r from-emerald-500 to-green-600 text-white border-emerald-400 shadow-lg shadow-emerald-500/30',
      inactive: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 hover:text-emerald-300'
    },
    {
      key: 'Minor',
      label: 'Minor',
      active: 'bg-gradient-to-r from-amber-500 to-orange-600 text-white border-amber-400 shadow-lg shadow-amber-500/30',
      inactive: 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20 hover:text-amber-300'
    },
    {
      key: 'Exotic',
      label: 'Exotic',
      active: 'bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white border-fuchsia-400 shadow-lg shadow-fuchsia-500/30',
      inactive: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30 hover:bg-fuchsia-500/20 hover:text-fuchsia-300'
    }
  ]

  const forexSubcategoryPills = form.segment === 'Forex' && (
    <div className="flex flex-wrap gap-2 mb-2">
      {FOREX_SUB_PILLS.map(({ key, label, active, inactive }) => {
        const isActive = forexSubcategory === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => handleSubcategoryChange(key)}
            className={`px-4 py-1.5 text-xs rounded-lg border font-semibold transition-all ${
              isActive ? active : inactive
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )

  const instrumentSelectEl = (
    <div>
      {forexSubcategoryPills}
      <select
        value={form.instrumentSymbol}
        onChange={handleInstrumentSymbolChange}
        className={instrumentSelectClass}
      >
        <option value="">All Instruments</option>
        {getInstrumentOptGroups(instruments, form.segment || null, forexSubcategory).map(({ category, items }) => (
          <optgroup key={category} label={category}>
            {items.map((inst) => {
              const label =
                inst.name && String(inst.name).trim() && inst.name !== inst.symbol
                  ? `${inst.symbol} (${inst.name})`
                  : inst.symbol
              return (
                <option key={inst.symbol} value={inst.symbol}>
                  {label}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
    </div>
  )

  const getSegmentBadgeClass = (segment) => {
    switch (segment) {
      case 'Forex': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      case 'Metals': return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      case 'Crypto': return 'bg-orange-500/15 text-orange-300 border-orange-500/30'
      case 'Commodities': return 'bg-teal-500/15 text-teal-300 border-teal-500/30'
      default: return 'bg-gray-600/30 text-gray-300 border-gray-600/40'
    }
  }

  const getLevelLabel = (charge) => {
    if (charge.level === 'USER') {
      const userName = charge.userId?.firstName 
        ? `${charge.userId.firstName} ${charge.userId.lastName || ''}`.trim()
        : charge.userId?.email || 'Unknown User'
      return `${userName} - ${charge.instrumentSymbol || 'All Instruments'}`
    }
    if (charge.level === 'INSTRUMENT') {
      return charge.instrumentSymbol
    }
    if (charge.level === 'SEGMENT') return charge.segment
    if (charge.level === 'GLOBAL') return 'Global'
    return charge.level
  }

  const getAccountTypeName = (charge) => {
    const at = charge.accountTypeId
    if (!at) return 'Global'
    if (typeof at === 'object') return at.name || 'Global'
    const found = accountTypes.find(a => String(a._id) === String(at))
    return found?.name || 'Global'
  }

  // Deterministic color per account-type name so admins can scan by color at a glance.
  const ACCOUNT_TYPE_PALETTE = [
    'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
    'bg-pink-500/10 text-pink-300 border-pink-500/30',
    'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    'bg-rose-500/10 text-rose-300 border-rose-500/30',
    'bg-lime-500/10 text-lime-300 border-lime-500/30',
    'bg-purple-500/10 text-purple-300 border-purple-500/30',
    'bg-teal-500/10 text-teal-300 border-teal-500/30',
    'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  ]

  const getAccountTypeBadgeClass = (name) => {
    if (!name || name === 'Global') return 'bg-gray-600/20 text-gray-400 border-gray-500/30'
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i)
      hash |= 0
    }
    return ACCOUNT_TYPE_PALETTE[Math.abs(hash) % ACCOUNT_TYPE_PALETTE.length]
  }

  return (
    <AdminLayout title="Forex Charges" subtitle="Manage trading fees and spreads">
      <div className="space-y-6">
        
        {/* COMMISSION SECTION */}
        <div className="bg-dark-800 rounded-xl border border-gray-800">
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-emerald-500/25 to-emerald-600/10 border border-emerald-500/30">
                <DollarSign size={20} className="text-emerald-400" />
              </div>
              <div>
                <h2 className="text-white font-semibold">Commission</h2>
                <p className="text-gray-500 text-sm">Trading fees per lot/trade</p>
              </div>
            </div>
            <button
              onClick={() => { resetForm(); setEditingCharge(null); setModalType('commission') }}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white rounded-lg font-medium shadow-lg shadow-emerald-500/20 transition-all"
            >
              <Plus size={16} />
              <span>Add Commission</span>
            </button>
          </div>
          <div className="p-4">
            {loading ? (
              <p className="text-gray-500 text-center py-4">Loading...</p>
            ) : charges.filter(c => c.commissionValue > 0).length === 0 ? (
              <p className="text-gray-500 text-center py-4">No commission charges configured</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  <div className="flex items-center gap-4 pl-1">
                    <span className="min-w-[72px] text-center">Segment</span>
                    <span className="min-w-[80px] text-center">Symbol</span>
                    <span className="min-w-[110px] text-center">Account Type</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span>Value</span>
                    <span className="min-w-[64px] text-right">Actions</span>
                  </div>
                </div>
                {charges.filter(c => c.commissionValue > 0).map((charge) => (
                  <div key={charge._id} className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
                    <div className="flex items-center gap-4 pl-1">
                      <span className={`inline-flex items-center justify-center min-w-[72px] px-2 py-1 text-[10px] font-semibold tracking-wide rounded-md border ${getSegmentBadgeClass(charge.segment)}`}>{charge.segment || charge.level}</span>
                      <span className="px-2.5 py-0.5 text-sm font-medium text-white border border-gray-600/60 rounded-md bg-dark-800/40">{getLevelLabel(charge)}</span>
                      <span className={`inline-flex items-center justify-center gap-1 min-w-[110px] px-2 py-1 text-[10px] font-semibold tracking-wide rounded-md border ${getAccountTypeBadgeClass(getAccountTypeName(charge))}`} title="Account Type">
                        <User size={10} />
                        <span className="truncate">{getAccountTypeName(charge)}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-white font-medium">${charge.commissionValue} <span className="text-gray-500 text-sm">({charge.commissionType})</span></span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEditModal(charge, 'commission')} className="p-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 hover:text-sky-300 transition-colors" title="Edit"><Edit size={14} /></button>
                        <button onClick={() => handleDelete(charge._id)} className="p-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SPREAD SECTION */}
        <div className="bg-dark-800 rounded-xl border border-gray-800">
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-sky-500/25 to-sky-600/10 border border-sky-500/30">
                <TrendingUp size={20} className="text-sky-400" />
              </div>
              <div>
                <h2 className="text-white font-semibold">Spread</h2>
                <p className="text-gray-500 text-sm">Bid/Ask price difference</p>
              </div>
            </div>
            <button
              onClick={() => { resetForm(); setEditingCharge(null); setModalType('spread') }}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white rounded-lg font-medium shadow-lg shadow-sky-500/20 transition-all"
            >
              <Plus size={16} />
              <span>Add Spread</span>
            </button>
          </div>
          <div className="p-4">
            {loading ? (
              <p className="text-gray-500 text-center py-4">Loading...</p>
            ) : charges.filter(c => c.spreadValue > 0).length === 0 ? (
              <p className="text-gray-500 text-center py-4">No spread charges configured</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  <div className="flex items-center gap-4 pl-1">
                    <span className="min-w-[72px] text-center">Segment</span>
                    <span className="min-w-[80px] text-center">Symbol</span>
                    <span className="min-w-[110px] text-center">Account Type</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span>Value</span>
                    <span className="min-w-[64px] text-right">Actions</span>
                  </div>
                </div>
                {charges.filter(c => c.spreadValue > 0).map((charge) => (
                  <div key={charge._id} className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
                    <div className="flex items-center gap-4 pl-1">
                      <span className={`inline-flex items-center justify-center min-w-[72px] px-2 py-1 text-[10px] font-semibold tracking-wide rounded-md border ${getSegmentBadgeClass(charge.segment)}`}>{charge.segment || charge.level}</span>
                      <span className="px-2.5 py-0.5 text-sm font-medium text-white border border-gray-600/60 rounded-md bg-dark-800/40">{getLevelLabel(charge)}</span>
                      <span className={`inline-flex items-center justify-center gap-1 min-w-[110px] px-2 py-1 text-[10px] font-semibold tracking-wide rounded-md border ${getAccountTypeBadgeClass(getAccountTypeName(charge))}`} title="Account Type">
                        <User size={10} />
                        <span className="truncate">{getAccountTypeName(charge)}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-white font-medium">{charge.spreadValue} <span className="text-gray-500 text-sm">({charge.spreadType})</span></span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEditModal(charge, 'spread')} className="p-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 hover:text-sky-300 transition-colors" title="Edit"><Edit size={14} /></button>
                        <button onClick={() => handleDelete(charge._id)} className="p-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SWAP SECTION */}
        <div className="bg-dark-800 rounded-xl border border-gray-800">
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-violet-500/25 to-violet-600/10 border border-violet-500/30">
                <Moon size={20} className="text-violet-400" />
              </div>
              <div>
                <h2 className="text-white font-semibold">Swap</h2>
                <p className="text-gray-500 text-sm">Overnight holding fees</p>
              </div>
            </div>
            <button
              onClick={() => { resetForm(); setEditingCharge(null); setModalType('swap') }}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white rounded-lg font-medium shadow-lg shadow-violet-500/20 transition-all"
            >
              <Plus size={16} />
              <span>Add Swap</span>
            </button>
          </div>
          <div className="p-4">
            {loading ? (
              <p className="text-gray-500 text-center py-4">Loading...</p>
            ) : charges.filter(c => c.swapLong !== 0 || c.swapShort !== 0).length === 0 ? (
              <p className="text-gray-500 text-center py-4">No swap charges configured</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  <div className="flex items-center gap-4 pl-1">
                    <span className="min-w-[72px] text-center">Segment</span>
                    <span className="min-w-[80px] text-center">Symbol</span>
                    <span className="min-w-[110px] text-center">Account Type</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span>Value</span>
                    <span className="min-w-[64px] text-right">Actions</span>
                  </div>
                </div>
                {charges.filter(c => c.swapLong !== 0 || c.swapShort !== 0).map((charge) => (
                  <div key={charge._id} className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
                    <div className="flex items-center gap-4 pl-1">
                      <span className={`inline-flex items-center justify-center min-w-[72px] px-2 py-1 text-[10px] font-semibold tracking-wide rounded-md border ${getSegmentBadgeClass(charge.segment)}`}>{charge.segment || charge.level}</span>
                      <span className="px-2.5 py-0.5 text-sm font-medium text-white border border-gray-600/60 rounded-md bg-dark-800/40">{getLevelLabel(charge)}</span>
                      <span className={`inline-flex items-center justify-center gap-1 min-w-[110px] px-2 py-1 text-[10px] font-semibold tracking-wide rounded-md border ${getAccountTypeBadgeClass(getAccountTypeName(charge))}`} title="Account Type">
                        <User size={10} />
                        <span className="truncate">{getAccountTypeName(charge)}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-white font-medium">Long: {charge.swapLong} | Short: {charge.swapShort}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEditModal(charge, 'swap')} className="p-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 hover:text-sky-300 transition-colors" title="Edit"><Edit size={14} /></button>
                        <button onClick={() => handleDelete(charge._id)} className="p-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* COMMISSION MODAL - Cascading Hierarchy */}
      {modalType === 'commission' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg max-h-[90vh] bg-gradient-to-b from-dark-800 to-dark-900 rounded-2xl border border-gray-700/60 shadow-2xl shadow-emerald-500/10 overflow-hidden flex flex-col">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-40 bg-emerald-500/15 blur-3xl pointer-events-none" />
            <div className="relative px-5 py-4 border-b border-gray-700/60 flex items-center justify-between bg-dark-800/60 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/25 to-emerald-600/10 border border-emerald-500/30 flex items-center justify-center">
                  <DollarSign size={18} className="text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white leading-tight">{editingCharge ? 'Edit Commission' : 'Add Commission'}</h2>
                  <p className="text-gray-500 text-xs">Configure trading fee per lot or trade</p>
                </div>
              </div>
              <button onClick={() => setModalType(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-dark-700 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="relative p-5 space-y-4 overflow-y-auto">
              {/* Step 1: Account Type */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">1. Account Type <span className="text-gray-600">(optional)</span></label>
                <select value={form.accountTypeId} onChange={(e) => {
                  const accountTypeId = e.target.value
                  const level = accountTypeId
                    ? 'ACCOUNT_TYPE'
                    : (form.instrumentSymbol ? 'INSTRUMENT' : (form.segment ? 'SEGMENT' : 'GLOBAL'))
                  setForm({ ...form, accountTypeId, level })
                }} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm">
                  <option value="">All Account Types (Global)</option>
                  {accountTypes.map(acc => <option key={acc._id} value={acc._id}>{acc.name}</option>)}
                </select>
              </div>

              {/* Step 2: Segment */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">2. Segment <span className="text-gray-600">(optional)</span></label>
                <select value={form.segment} onChange={(e) => {
                  const segment = e.target.value
                  const level = form.accountTypeId
                    ? 'ACCOUNT_TYPE'
                    : (segment ? 'SEGMENT' : 'GLOBAL')
                  setForm({ ...form, segment, instrumentSymbol: '', level })
                }} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm">
                  <option value="Forex">Forex</option>
                  <option value="Metals">Metals</option>
                  <option value="Crypto">Crypto</option>
                  <option value="Commodities">Commodities</option>
                </select>
              </div>

              {/* Step 3: Instrument - Filtered by Segment */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">3. Instrument <span className="text-gray-600">(optional{form.segment ? ` - showing ${form.segment} only` : ''})</span></label>
                {instrumentSelectEl}
                {instruments.length === 0 && (
                  <p className="text-gray-500 text-xs mt-1">Loading symbols from trading API…</p>
                )}
              </div>

              {/* Step 4: User (Optional - Highest Priority) */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">4. Specific User <span className="text-gray-600">(optional - highest priority)</span></label>
                {selectedUser ? (
                  <div className="flex items-center justify-between p-2 bg-dark-700 border border-gray-600 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white text-xs">{selectedUser.firstName?.charAt(0)}</div>
                      <div>
                        <p className="text-white text-sm">{selectedUser.firstName} {selectedUser.lastName}</p>
                        <p className="text-gray-500 text-xs">{selectedUser.email}</p>
                      </div>
                    </div>
                    <button onClick={() => { setSelectedUser(null); setForm({ ...form, userId: '', level: form.instrumentSymbol ? 'INSTRUMENT' : form.segment ? 'SEGMENT' : form.accountTypeId ? 'ACCOUNT_TYPE' : 'GLOBAL' }) }} className="text-gray-400 hover:text-white"><X size={16} /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input type="text" placeholder="Search user to override..." value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setShowUserDropdown(true) }} onFocus={() => setShowUserDropdown(true)} className="w-full pl-9 pr-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm" />
                    {showUserDropdown && userSearch && (
                      <div className="absolute z-10 w-full mt-1 bg-dark-700 border border-gray-600 rounded-lg max-h-40 overflow-y-auto">
                        {filteredUsers.length === 0 ? (
                          <p className="p-2 text-gray-500 text-sm">No users found</p>
                        ) : (
                          filteredUsers.slice(0, 10).map(user => (
                            <button key={user._id} onClick={() => { setSelectedUser(user); setForm({ ...form, userId: user._id, level: 'USER' }); setShowUserDropdown(false); setUserSearch('') }} className="w-full flex items-center gap-2 p-2 hover:bg-dark-600 text-left">
                              <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center text-white text-xs">{user.firstName?.charAt(0)}</div>
                              <div>
                                <p className="text-white text-sm">{user.firstName} {user.lastName}</p>
                                <p className="text-gray-500 text-xs">{user.email}</p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Applied Level Indicator */}
              <div className="bg-dark-700 rounded-lg p-2 text-xs">
                <span className="text-gray-400">Applies to: </span>
                <span className="text-white font-medium">
                  {form.userId ? `User: ${selectedUser?.firstName || 'Selected'}` : ''}
                  {form.userId && form.instrumentSymbol ? ' → ' : ''}
                  {form.instrumentSymbol ? `${form.instrumentSymbol}` : ''}
                  {(form.userId || form.instrumentSymbol) && form.segment ? ' → ' : ''}
                  {form.segment ? `${form.segment}` : ''}
                  {(form.userId || form.instrumentSymbol || form.segment) && form.accountTypeId ? ' → ' : ''}
                  {form.accountTypeId ? accountTypes.find(a => a._id === form.accountTypeId)?.name : ''}
                  {!form.userId && !form.instrumentSymbol && !form.segment && !form.accountTypeId ? 'Global (All)' : ''}
                </span>
              </div>
              
              {/* Commission Settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Commission Type</label>
                  <select value={form.commissionType} onChange={(e) => setForm({ ...form, commissionType: e.target.value })} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm">
                    <option value="PER_LOT">Per Lot ($)</option>
                    <option value="PER_TRADE">Per Trade ($)</option>
                    <option value="PERCENTAGE">Percentage (%)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Value</label>
                  <input type="number" step="0.01" value={form.commissionValue} onChange={(e) => setForm({ ...form, commissionValue: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm" placeholder="0" />
                </div>
              </div>
              
              {/* Charge On */}
              <div>
                <label className="block text-gray-400 text-xs mb-2">Charge on:</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.commissionOnBuy} onChange={(e) => setForm({ ...form, commissionOnBuy: e.target.checked })} className="w-4 h-4 rounded bg-dark-600 border-gray-600" />
                    <span className="text-white text-sm">Buy</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.commissionOnSell} onChange={(e) => setForm({ ...form, commissionOnSell: e.target.checked })} className="w-4 h-4 rounded bg-dark-600 border-gray-600" />
                    <span className="text-white text-sm">Sell</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.commissionOnClose} onChange={(e) => setForm({ ...form, commissionOnClose: e.target.checked })} className="w-4 h-4 rounded bg-dark-600 border-gray-600" />
                    <span className="text-white text-sm">Close</span>
                  </label>
                </div>
              </div>
              
              <div className="flex gap-3 pt-2 border-t border-gray-700/40 mt-2 pt-4">
                <button onClick={() => setModalType(null)} className="flex-1 py-2.5 bg-dark-700 hover:bg-dark-600 text-white rounded-xl text-sm font-medium border border-gray-700/50 transition-colors">Cancel</button>
                <button onClick={handleSave} className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                  <Save size={14} />
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SPREAD MODAL - Account Type first, then Instrument selection */}
      {modalType === 'spread' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg max-h-[90vh] bg-gradient-to-b from-dark-800 to-dark-900 rounded-2xl border border-gray-700/60 shadow-2xl shadow-sky-500/10 overflow-hidden flex flex-col">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-sky-500/60 to-transparent" />
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-40 bg-sky-500/15 blur-3xl pointer-events-none" />
            <div className="relative px-5 py-4 border-b border-gray-700/60 flex items-center justify-between bg-dark-800/60 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/25 to-sky-600/10 border border-sky-500/30 flex items-center justify-center">
                  <TrendingUp size={18} className="text-sky-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white leading-tight">{editingCharge ? 'Edit Spread' : 'Add Spread'}</h2>
                  <p className="text-gray-500 text-xs">Set the Bid/Ask price difference</p>
                </div>
              </div>
              <button onClick={() => setModalType(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-dark-700 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="relative p-5 space-y-4 overflow-y-auto">
              {/* Step 1: Account Type */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">1. Account Type <span className="text-gray-600">(optional)</span></label>
                <select value={form.accountTypeId} onChange={(e) => {
                  const accountTypeId = e.target.value
                  const level = accountTypeId
                    ? 'ACCOUNT_TYPE'
                    : (form.instrumentSymbol ? 'INSTRUMENT' : (form.segment ? 'SEGMENT' : 'GLOBAL'))
                  setForm({ ...form, accountTypeId, level })
                }} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm">
                  <option value="">All Account Types (Global)</option>
                  {accountTypes.map(acc => <option key={acc._id} value={acc._id}>{acc.name}</option>)}
                </select>
              </div>

              {/* Step 2: Segment Filter */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">2. Segment <span className="text-gray-600">(optional)</span></label>
                <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value, instrumentSymbol: '' })} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm">
                  <option value="Forex">Forex</option>
                  <option value="Metals">Metals</option>
                  <option value="Crypto">Crypto</option>
                  <option value="Commodities">Commodities</option>
                </select>
              </div>

              {/* Step 3: Instrument - Filtered by Segment */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">3. Instrument <span className="text-gray-600">(optional{form.segment ? ` - showing ${form.segment} only` : ''})</span></label>
                {instrumentSelectEl}
                {instruments.length === 0 && (
                  <p className="text-gray-500 text-xs mt-1">Loading symbols from trading API…</p>
                )}
              </div>

              {/* Step 4: User Override (Optional) */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">4. User Override <span className="text-gray-600">(optional - for specific user only)</span></label>
                {selectedUser ? (
                  <div className="flex items-center justify-between p-2 bg-dark-700 border border-gray-600 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white text-xs">{selectedUser.firstName?.charAt(0)}</div>
                      <div>
                        <p className="text-white text-sm">{selectedUser.firstName} {selectedUser.lastName}</p>
                        <p className="text-gray-500 text-xs">{selectedUser.email}</p>
                      </div>
                    </div>
                    <button onClick={() => { setSelectedUser(null); setForm({ ...form, userId: '', level: form.instrumentSymbol ? 'INSTRUMENT' : form.accountTypeId ? 'ACCOUNT_TYPE' : (form.segment ? 'SEGMENT' : 'GLOBAL') }) }} className="text-gray-400 hover:text-white"><X size={16} /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input type="text" placeholder="Search user for custom spread..." value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setShowUserDropdown(true) }} onFocus={() => setShowUserDropdown(true)} className="w-full pl-9 pr-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm" />
                    {showUserDropdown && userSearch && (
                      <div className="absolute z-10 w-full mt-1 bg-dark-700 border border-gray-600 rounded-lg max-h-40 overflow-y-auto">
                        {filteredUsers.length === 0 ? (
                          <p className="p-2 text-gray-500 text-sm">No users found</p>
                        ) : (
                          filteredUsers.slice(0, 10).map(user => (
                            <button key={user._id} onClick={() => { setSelectedUser(user); setForm({ ...form, userId: user._id, level: 'USER' }); setShowUserDropdown(false); setUserSearch('') }} className="w-full flex items-center gap-2 p-2 hover:bg-dark-600 text-left">
                              <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center text-white text-xs">{user.firstName?.charAt(0)}</div>
                              <div>
                                <p className="text-white text-sm">{user.firstName} {user.lastName}</p>
                                <p className="text-gray-500 text-xs">{user.email}</p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Applied Level Indicator */}
              <div className="bg-dark-700 rounded-lg p-2 text-xs">
                <span className="text-gray-400">Applies to: </span>
                <span className="text-white font-medium">
                  {form.userId ? `User: ${selectedUser?.firstName || 'Selected'}` : ''}
                  {form.userId && form.instrumentSymbol ? ' → ' : ''}
                  {form.instrumentSymbol ? `${form.instrumentSymbol}` : ''}
                  {(form.userId || form.instrumentSymbol) && form.accountTypeId ? ' → ' : ''}
                  {form.accountTypeId ? accountTypes.find(a => a._id === form.accountTypeId)?.name : ''}
                  {!form.userId && !form.instrumentSymbol && !form.accountTypeId ? 'Global (All)' : ''}
                </span>
              </div>
              
              {/* Spread Settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Spread Type</label>
                  <select value={form.spreadType} onChange={(e) => setForm({ ...form, spreadType: e.target.value })} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm">
                    <option value="FIXED">Fixed (Pips/Cents)</option>
                    <option value="PERCENTAGE">Percentage (%)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Spread Value</label>
                  <input type="number" step="0.01" value={form.spreadValue} onChange={(e) => setForm({ ...form, spreadValue: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm" placeholder="0" />
                </div>
              </div>
              
              <p className="text-gray-500 text-xs">Forex: pips (e.g., 1.5) | Gold: cents (e.g., 50) | Crypto: USD (e.g., 10)</p>
              
              <div className="flex gap-3 pt-2 border-t border-gray-700/40 mt-2 pt-4">
                <button onClick={() => setModalType(null)} className="flex-1 py-2.5 bg-dark-700 hover:bg-dark-600 text-white rounded-xl text-sm font-medium border border-gray-700/50 transition-colors">Cancel</button>
                <button onClick={handleSave} className="flex-1 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-sky-500/20 transition-all flex items-center justify-center gap-2">
                  <Save size={14} />
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SWAP MODAL - Cascading Hierarchy */}
      {modalType === 'swap' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg max-h-[90vh] bg-gradient-to-b from-dark-800 to-dark-900 rounded-2xl border border-gray-700/60 shadow-2xl shadow-violet-500/10 overflow-hidden flex flex-col">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" />
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-40 bg-violet-500/15 blur-3xl pointer-events-none" />
            <div className="relative px-5 py-4 border-b border-gray-700/60 flex items-center justify-between bg-dark-800/60 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/25 to-violet-600/10 border border-violet-500/30 flex items-center justify-center">
                  <Moon size={18} className="text-violet-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white leading-tight">{editingCharge ? 'Edit Swap' : 'Add Swap'}</h2>
                  <p className="text-gray-500 text-xs">Set overnight holding fees (long / short)</p>
                </div>
              </div>
              <button onClick={() => setModalType(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-dark-700 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="relative p-5 space-y-4 overflow-y-auto">
              {/* Step 1: Account Type */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">1. Account Type <span className="text-gray-600">(optional)</span></label>
                <select value={form.accountTypeId} onChange={(e) => {
                  const accountTypeId = e.target.value
                  const level = accountTypeId
                    ? 'ACCOUNT_TYPE'
                    : (form.instrumentSymbol ? 'INSTRUMENT' : (form.segment ? 'SEGMENT' : 'GLOBAL'))
                  setForm({ ...form, accountTypeId, level })
                }} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm">
                  <option value="">All Account Types (Global)</option>
                  {accountTypes.map(acc => <option key={acc._id} value={acc._id}>{acc.name}</option>)}
                </select>
              </div>

              {/* Step 2: Segment Filter */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">2. Segment <span className="text-gray-600">(optional)</span></label>
                <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value, instrumentSymbol: '' })} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm">
                  <option value="Forex">Forex</option>
                  <option value="Metals">Metals</option>
                  <option value="Crypto">Crypto</option>
                  <option value="Commodities">Commodities</option>
                </select>
              </div>

              {/* Step 3: Instrument - Filtered by Segment */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">3. Instrument <span className="text-gray-600">(optional{form.segment ? ` - showing ${form.segment} only` : ''})</span></label>
                {instrumentSelectEl}
                {instruments.length === 0 && (
                  <p className="text-gray-500 text-xs mt-1">Loading symbols from trading API…</p>
                )}
              </div>

              {/* Step 4: User Override (Optional) */}
              <div>
                <label className="block text-gray-400 text-xs mb-1">4. User Override <span className="text-gray-600">(optional - for specific user only)</span></label>
                {selectedUser ? (
                  <div className="flex items-center justify-between p-2 bg-dark-700 border border-gray-600 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white text-xs">{selectedUser.firstName?.charAt(0)}</div>
                      <div>
                        <p className="text-white text-sm">{selectedUser.firstName} {selectedUser.lastName}</p>
                        <p className="text-gray-500 text-xs">{selectedUser.email}</p>
                      </div>
                    </div>
                    <button onClick={() => { setSelectedUser(null); setForm({ ...form, userId: '', level: form.instrumentSymbol ? 'INSTRUMENT' : form.accountTypeId ? 'ACCOUNT_TYPE' : (form.segment ? 'SEGMENT' : 'GLOBAL') }) }} className="text-gray-400 hover:text-white"><X size={16} /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input type="text" placeholder="Search user for custom swap..." value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setShowUserDropdown(true) }} onFocus={() => setShowUserDropdown(true)} className="w-full pl-9 pr-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm" />
                    {showUserDropdown && userSearch && (
                      <div className="absolute z-10 w-full mt-1 bg-dark-700 border border-gray-600 rounded-lg max-h-40 overflow-y-auto">
                        {filteredUsers.length === 0 ? (
                          <p className="p-2 text-gray-500 text-sm">No users found</p>
                        ) : (
                          filteredUsers.slice(0, 10).map(user => (
                            <button key={user._id} onClick={() => { setSelectedUser(user); setForm({ ...form, userId: user._id, level: 'USER' }); setShowUserDropdown(false); setUserSearch('') }} className="w-full flex items-center gap-2 p-2 hover:bg-dark-600 text-left">
                              <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center text-white text-xs">{user.firstName?.charAt(0)}</div>
                              <div>
                                <p className="text-white text-sm">{user.firstName} {user.lastName}</p>
                                <p className="text-gray-500 text-xs">{user.email}</p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Applied Level Indicator */}
              <div className="bg-dark-700 rounded-lg p-2 text-xs">
                <span className="text-gray-400">Applies to: </span>
                <span className="text-white font-medium">
                  {form.userId ? `User: ${selectedUser?.firstName || 'Selected'}` : ''}
                  {form.userId && form.instrumentSymbol ? ' → ' : ''}
                  {form.instrumentSymbol ? `${form.instrumentSymbol}` : ''}
                  {(form.userId || form.instrumentSymbol) && form.accountTypeId ? ' → ' : ''}
                  {form.accountTypeId ? accountTypes.find(a => a._id === form.accountTypeId)?.name : ''}
                  {!form.userId && !form.instrumentSymbol && !form.accountTypeId ? 'Global (All)' : ''}
                </span>
              </div>
              
              {/* Swap Settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Swap Long (points)</label>
                  <input type="number" step="0.01" value={form.swapLong} onChange={(e) => setForm({ ...form, swapLong: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Swap Short (points)</label>
                  <input type="number" step="0.01" value={form.swapShort} onChange={(e) => setForm({ ...form, swapShort: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white text-sm" placeholder="0" />
                </div>
              </div>
              
              <p className="text-gray-500 text-xs">Overnight fees charged for holding positions (negative = charge, positive = credit)</p>
              
              <div className="flex gap-3 pt-2 border-t border-gray-700/40 mt-2 pt-4">
                <button onClick={() => setModalType(null)} className="flex-1 py-2.5 bg-dark-700 hover:bg-dark-600 text-white rounded-xl text-sm font-medium border border-gray-700/50 transition-colors">Cancel</button>
                <button onClick={handleSave} className="flex-1 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-violet-500/20 transition-all flex items-center justify-center gap-2">
                  <Save size={14} />
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteConfirmId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => !deleting && setDeleteConfirmId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-gradient-to-b from-dark-800 to-dark-900 rounded-2xl border border-gray-700/60 shadow-2xl shadow-red-500/10 overflow-hidden"
          >
            {/* Decorative top glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-red-500/20 rounded-full blur-3xl pointer-events-none" />

            <div className="relative p-6">
              {/* Icon */}
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-red-500/30 rounded-full blur-xl" />
                  <div className="relative w-16 h-16 bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-500/30 rounded-full flex items-center justify-center">
                    <Trash2 size={28} className="text-red-400" />
                  </div>
                </div>
              </div>

              {/* Title + message */}
              <div className="text-center mb-6">
                <h3 className="text-xl font-semibold text-white mb-2">Delete this charge?</h3>
                <p className="text-gray-400 text-sm">
                  This action cannot be undone. The charge configuration will be permanently removed.
                </p>
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  disabled={deleting}
                  className="flex-1 py-2.5 bg-dark-700 hover:bg-dark-600 text-white rounded-xl text-sm font-medium transition-colors border border-gray-700/50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="flex-1 py-2.5 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-red-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      Delete
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

export default AdminForexCharges
