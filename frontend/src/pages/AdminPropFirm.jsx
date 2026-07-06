import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import AdminLayout from '../components/AdminLayout'
import { 
  Trophy,
  Plus,
  Search,
  Eye,
  Edit,
  Trash2,
  Users,
  Target,
  DollarSign,
  CheckCircle,
  XCircle,
  Clock,
  ToggleLeft,
  ToggleRight,
  Settings,
  X
} from 'lucide-react'
import { API_URL } from '../config/api'
import { confirmToast, promptToast } from '../utils/dialogs'

const AdminPropFirm = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState('challenges')
  const [challengeModeEnabled, setChallengeModeEnabled] = useState(false)
  const [challenges, setChallenges] = useState([])
  const [participants, setParticipants] = useState([])
  const [payouts, setPayouts] = useState([])
  const [participantsPage, setParticipantsPage] = useState(1)
  const PARTICIPANTS_PER_PAGE = 5
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showChallengeModal, setShowChallengeModal] = useState(false)
  const [editingChallenge, setEditingChallenge] = useState(null)
  const [settings, setSettings] = useState({
    displayName: 'Prop Trading Challenge',
    description: 'Trade with our capital. Pass the challenge and get funded.',
    termsAndConditions: ''
  })
  
  const defaultChallengeForm = {
    name: '',
    description: '',
    stepsCount: 0,
    fundSize: 10000,
    challengeFee: 99,
    rules: {
      maxDailyDrawdownPercent: 5,
      maxOverallDrawdownPercent: 10,
      drawdownType: 'STATIC',
      profitTargetPhase1Percent: 8,
      profitTargetPhase2Percent: 5,
      minLotSize: 0.01,
      maxLotSize: 100,
      minTradesRequired: 1,
      maxTradesPerDay: null,
      maxTotalTrades: null,
      maxConcurrentTrades: null,
      stopLossMandatory: true,
      takeProfitMandatory: false,
      minTradeHoldTimeSeconds: 0,
      maxLeverage: 100,
      allowWeekendHolding: false,
      allowNewsTrading: true,
      tradingDaysRequired: null,
      challengeExpiryDays: 30,
      allowedSegments: ['FOREX', 'CRYPTO', 'STOCKS', 'COMMODITIES', 'INDICES']
    },
    fundedSettings: {
      profitSplitPercent: 80,
      withdrawalFrequencyDays: 14
    },
    isActive: true
  }
  
  const [challengeForm, setChallengeForm] = useState(defaultChallengeForm)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch settings
      const settingsRes = await fetch(`${API_URL}/prop/admin/settings`)
      const settingsData = await settingsRes.json()
      if (settingsData.success) {
        setChallengeModeEnabled(settingsData.settings.challengeModeEnabled)
        setSettings({
          displayName: settingsData.settings.displayName || 'Prop Trading Challenge',
          description: settingsData.settings.description || '',
          termsAndConditions: settingsData.settings.termsAndConditions || ''
        })
      }

      // Fetch challenges
      const challengesRes = await fetch(`${API_URL}/prop/admin/challenges`)
      const challengesData = await challengesRes.json()
      if (challengesData.success) {
        setChallenges(challengesData.challenges || [])
      }

      // Fetch participants
      const accountsRes = await fetch(`${API_URL}/prop/admin/accounts?limit=50`)
      const accountsData = await accountsRes.json()
      if (accountsData.success) {
        setParticipants(accountsData.accounts || [])
      }

      // Fetch dashboard stats
      const dashRes = await fetch(`${API_URL}/prop/admin/dashboard`)
      const dashData = await dashRes.json()
      if (dashData.success) {
        setStats(dashData.stats || {})
      }

      // Fetch payout requests
      const payoutsRes = await fetch(`${API_URL}/prop/admin/payouts`)
      const payoutsData = await payoutsRes.json()
      if (payoutsData.success) {
        setPayouts(payoutsData.payouts || [])
      }
    } catch (error) {
      console.error('Error fetching prop data:', error)
    }
    setLoading(false)
  }

  const toggleChallengeMode = async () => {
    try {
      const newValue = !challengeModeEnabled
      const res = await fetch(`${API_URL}/prop/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeModeEnabled: newValue })
      })
      const data = await res.json()
      if (data.success) {
        setChallengeModeEnabled(newValue)
        toast.success(newValue ? 'Challenge mode enabled! Users can now buy challenges.' : 'Challenge mode disabled.')
      }
    } catch (error) {
      console.error('Error toggling challenge mode:', error)
      toast.error('Failed to update challenge mode')
    }
  }

  const saveSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/prop/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeModeEnabled,
          ...settings
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Settings saved successfully!')
        setShowSettingsModal(false)
      }
    } catch (error) {
      console.error('Error saving settings:', error)
      toast.error('Failed to save settings')
    }
  }

  const openAddChallenge = () => {
    setEditingChallenge(null)
    setChallengeForm(defaultChallengeForm)
    setShowChallengeModal(true)
  }

  const openEditChallenge = (challenge) => {
    setEditingChallenge(challenge)
    setChallengeForm({
      name: challenge.name || '',
      description: challenge.description || '',
      stepsCount: challenge.stepsCount ?? 0,
      fundSize: challenge.fundSize || 10000,
      challengeFee: challenge.challengeFee || 99,
      rules: {
        ...defaultChallengeForm.rules,
        ...challenge.rules
      },
      fundedSettings: {
        ...defaultChallengeForm.fundedSettings,
        ...challenge.fundedSettings
      },
      isActive: challenge.isActive !== false
    })
    setShowChallengeModal(true)
  }

  const saveChallenge = async () => {
    if (!challengeForm.name) {
      toast.error('Please enter a challenge name')
      return
    }
    try {
      const url = editingChallenge 
        ? `${API_URL}/prop/admin/challenges/${editingChallenge._id}`
        : `${API_URL}/prop/admin/challenges`
      const method = editingChallenge ? 'PUT' : 'POST'
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(challengeForm)
      })
      const data = await res.json()
      if (data.success) {
        toast.success(editingChallenge ? 'Challenge updated!' : 'Challenge created!')
        setShowChallengeModal(false)
        fetchData()
      } else {
        toast.error(data.message || 'Failed to save challenge')
      }
    } catch (error) {
      console.error('Error saving challenge:', error)
      toast.error('Failed to save challenge')
    }
  }

  const deleteChallenge = async (challengeId) => {
    if (!(await confirmToast('Are you sure you want to delete this challenge?'))) return
    try {
      const res = await fetch(`${API_URL}/prop/admin/challenges/${challengeId}`, {
        method: 'DELETE'
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Challenge deleted!')
        fetchData()
      } else {
        toast.error(data.message || 'Failed to delete challenge')
      }
    } catch (error) {
      console.error('Error deleting challenge:', error)
      toast.error('Failed to delete challenge')
    }
  }

  const deleteParticipant = async (account) => {
    const name = account.userId?.firstName || account.userId?.email || 'this participant'
    if (!(await confirmToast(`Delete ${name}'s challenge account (${account.accountId})? Their trades will also be removed. This cannot be undone.`))) return
    try {
      const res = await fetch(`${API_URL}/prop/admin/account/${account._id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        toast.success('Participant deleted')
        fetchData()
      } else {
        toast.error(data.message || 'Failed to delete participant')
      }
    } catch (error) {
      toast.error('Failed to delete participant')
    }
  }

  // Filter + paginate participants (default 5 per page)
  const filteredParticipants = participants.filter((p) => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return true
    return (p.userId?.firstName || '').toLowerCase().includes(q) ||
      (p.userId?.email || '').toLowerCase().includes(q) ||
      (p.challengeId?.name || '').toLowerCase().includes(q)
  })
  const participantsTotalPages = Math.max(1, Math.ceil(filteredParticipants.length / PARTICIPANTS_PER_PAGE))
  const participantsCurrentPage = Math.min(participantsPage, participantsTotalPages)
  const pagedParticipants = filteredParticipants.slice(
    (participantsCurrentPage - 1) * PARTICIPANTS_PER_PAGE,
    participantsCurrentPage * PARTICIPANTS_PER_PAGE
  )

  const adminId = (() => { try { return JSON.parse(localStorage.getItem('admin') || '{}')._id } catch { return null } })()

  const approvePayout = async (id) => {
    if (!(await confirmToast('Approve this payout and credit the trader\'s wallet?', { confirmText: 'Approve', danger: false }))) return
    try {
      const res = await fetch(`${API_URL}/prop/admin/payout/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Payout approved and credited')
        fetchData()
      } else {
        toast.error(data.message || 'Failed to approve payout')
      }
    } catch (error) {
      toast.error('Failed to approve payout')
    }
  }

  const rejectPayout = async (id) => {
    const reason = (await promptToast('Reason for rejection (optional):', { confirmText: 'Reject' })) || ''
    try {
      const res = await fetch(`${API_URL}/prop/admin/payout/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId, reason })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Payout rejected')
        fetchData()
      } else {
        toast.error(data.message || 'Failed to reject payout')
      }
    } catch (error) {
      toast.error('Failed to reject payout')
    }
  }

  const updateFormRules = (field, value) => {
    setChallengeForm({
      ...challengeForm,
      rules: { ...challengeForm.rules, [field]: value }
    })
  }

  const updateFormFunded = (field, value) => {
    setChallengeForm({
      ...challengeForm,
      fundedSettings: { ...challengeForm.fundedSettings, [field]: value }
    })
  }

  const getStatusColor = (status) => {
    const s = status?.toUpperCase()
    switch (s) {
      case 'ACTIVE': return 'bg-blue-500/20 text-blue-500'
      case 'PASSED': return 'bg-green-500/20 text-green-500'
      case 'FUNDED': return 'bg-purple-500/20 text-purple-500'
      case 'FAILED': return 'bg-red-500/20 text-red-500'
      case 'EXPIRED': return 'bg-orange-500/20 text-orange-500'
      default: return 'bg-gray-500/20 text-gray-400'
    }
  }

  const getStatusIcon = (status) => {
    const s = status?.toUpperCase()
    switch (s) {
      case 'ACTIVE': return <Clock size={14} />
      case 'PASSED': 
      case 'FUNDED': return <CheckCircle size={14} />
      case 'FAILED': 
      case 'EXPIRED': return <XCircle size={14} />
      default: return null
    }
  }

  return (
    <AdminLayout title="Prop Firm Challenges" subtitle="Manage trading challenges and funded accounts">
      {/* Challenge Mode Toggle */}
      <div className="bg-dark-800 rounded-xl p-5 border border-gray-800 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${challengeModeEnabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
              <Trophy size={24} className={challengeModeEnabled ? 'text-green-500' : 'text-gray-500'} />
            </div>
            <div>
              <h3 className="text-white font-semibold text-lg">Challenge Mode</h3>
              <p className="text-gray-500 text-sm">
                {challengeModeEnabled 
                  ? 'Users can buy and participate in challenges' 
                  : 'Challenge purchases are disabled for users'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2 hover:bg-dark-700 rounded-lg transition-colors text-gray-400 hover:text-white"
              title="Settings"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={toggleChallengeMode}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                challengeModeEnabled 
                  ? 'bg-green-500 text-white hover:bg-green-600' 
                  : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
              }`}
            >
              {challengeModeEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              {challengeModeEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-dark-800 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={18} className="text-yellow-500" />
            <p className="text-gray-500 text-sm">Active Challenges</p>
          </div>
          <p className="text-white text-2xl font-bold">{stats.totalChallenges || challenges.length}</p>
        </div>
        <div className="bg-dark-800 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <Users size={18} className="text-blue-500" />
            <p className="text-gray-500 text-sm">Total Participants</p>
          </div>
          <p className="text-white text-2xl font-bold">{stats.totalAccounts || 0}</p>
        </div>
        <div className="bg-dark-800 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={18} className="text-green-500" />
            <p className="text-gray-500 text-sm">Passed</p>
          </div>
          <p className="text-white text-2xl font-bold">{stats.passedAccounts || 0}</p>
        </div>
        <div className="bg-dark-800 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={18} className="text-red-500" />
            <p className="text-gray-500 text-sm">Failed</p>
          </div>
          <p className="text-white text-2xl font-bold">{stats.failedAccounts || 0}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('challenges')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'challenges' ? 'bg-yellow-500 text-black' : 'bg-dark-700 text-gray-400 hover:text-white'
          }`}
        >
          Challenges
        </button>
        <button
          onClick={() => setActiveTab('participants')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'participants' ? 'bg-yellow-500 text-black' : 'bg-dark-700 text-gray-400 hover:text-white'
          }`}
        >
          Participants
        </button>
        <button
          onClick={() => setActiveTab('payouts')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'payouts' ? 'bg-yellow-500 text-black' : 'bg-dark-700 text-gray-400 hover:text-white'
          }`}
        >
          Payouts{payouts.filter(p => p.status === 'Pending').length > 0 ? ` (${payouts.filter(p => p.status === 'Pending').length})` : ''}
        </button>
      </div>

      {/* Challenges Tab */}
      {activeTab === 'challenges' && (
        <div className="bg-dark-800 rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-800">
            <h2 className="text-white font-semibold text-lg">Challenge Types</h2>
            <button 
              onClick={openAddChallenge}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-black rounded-lg hover:bg-yellow-400 transition-colors"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Add Challenge</span>
            </button>
          </div>

          <div className="p-4 space-y-8">
            {challenges.length === 0 ? (
              <div className="text-center py-12">
                <Trophy size={48} className="text-gray-600 mx-auto mb-4" />
                <p className="text-gray-500">No challenges created yet</p>
                <p className="text-gray-600 text-sm">Click "Add Challenge" to create your first challenge</p>
              </div>
            ) : (
              [
                { key: 0, label: 'Instant Fund' },
                { key: 1, label: 'One Step' },
                { key: 2, label: 'Two Step' },
              ].map((group) => {
                const groupChallenges = challenges.filter((c) => (c.stepsCount ?? 0) === group.key)
                if (groupChallenges.length === 0) return null
                return (
                  <div key={group.key}>
                    <div className="flex items-center gap-3 mb-4">
                      <h3 className="text-white font-semibold text-lg">{group.label}</h3>
                      <span className="px-2 py-0.5 rounded-full text-xs bg-dark-600 text-gray-400">
                        {groupChallenges.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {groupChallenges.map((challenge) => (
                <div key={challenge._id} className="bg-dark-700 rounded-xl p-5 border border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-semibold text-lg">{challenge.name}</h3>
                    <span className={`px-2 py-1 rounded-full text-xs ${challenge.isActive ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-400'}`}>
                      {challenge.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <p className="text-gray-500 text-sm">Account Size</p>
                      <p className="text-white font-medium">${(challenge.fundSize || 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-sm">Profit Target</p>
                      <p className="text-green-500 font-medium">
                        {challenge.stepsCount === 0
                          ? 'N/A'
                          : `${challenge.rules?.profitTargetPhase1Percent ?? 8}%`}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-sm">Max Drawdown</p>
                      <p className="text-red-500 font-medium">{challenge.rules?.maxOverallDrawdownPercent ?? 10}%</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-sm">Duration</p>
                      <p className="text-white font-medium">{challenge.rules?.challengeExpiryDays ?? 30} days</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-gray-600">
                    <div>
                      <p className="text-yellow-500 font-bold text-xl">${(challenge.challengeFee || 0).toLocaleString()}</p>
                      <p className="text-gray-500 text-sm">{challenge.stepsCount === 0 ? 'Instant Fund' : challenge.stepsCount === 1 ? '1-Step' : '2-Step'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => openEditChallenge(challenge)}
                        className="p-2 hover:bg-dark-600 rounded-lg transition-colors text-gray-400 hover:text-white"
                      >
                        <Edit size={16} />
                      </button>
                      <button 
                        onClick={() => deleteChallenge(challenge._id)}
                        className="p-2 hover:bg-dark-600 rounded-lg transition-colors text-gray-400 hover:text-red-500"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Participants Tab */}
      {activeTab === 'participants' && (
        <div className="bg-dark-800 rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 border-b border-gray-800">
            <h2 className="text-white font-semibold text-lg">Challenge Participants</h2>
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search participants..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:w-64 bg-dark-700 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gray-600"
              />
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="block lg:hidden p-4 space-y-3">
            {filteredParticipants.length === 0 ? (
              <div className="text-center py-12">
                <Users size={48} className="text-gray-600 mx-auto mb-4" />
                <p className="text-gray-500">No participants yet</p>
              </div>
            ) : (
              pagedParticipants.map((p) => (
                <div key={p._id} className="bg-dark-700 rounded-xl p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-white font-medium">{p.userId?.firstName || p.userId?.email || 'Unknown'}</p>
                      <p className="text-gray-500 text-sm">{p.challengeId?.name || 'Challenge'}</p>
                    </div>
                    <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${getStatusColor(p.status)}`}>
                      {getStatusIcon(p.status)}
                      {p.status}
                    </span>
                  </div>
                  <div className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-500">Balance</span>
                      <span className="text-white">${(p.currentBalance || 0).toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-dark-600 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${p.status === 'FAILED' ? 'bg-red-500' : p.status === 'PASSED' ? 'bg-green-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(((p.currentBalance - p.initialBalance) / p.initialBalance * 100) + 50, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">P&L</span>
                    <span className={(p.currentBalance - p.initialBalance) >= 0 ? 'text-green-500' : 'text-red-500'}>
                      {(p.currentBalance - p.initialBalance) >= 0 ? '+' : ''}${((p.currentBalance || 0) - (p.initialBalance || 0)).toLocaleString()}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteParticipant(p)}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 bg-red-500/15 text-red-400 rounded-lg text-sm hover:bg-red-500/25 transition-colors"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">User</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Challenge</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Balance</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">P&L</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Status</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Start Date</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredParticipants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-500">No participants yet</td>
                  </tr>
                ) : (
                  pagedParticipants.map((p) => {
                    const pnl = (p.currentBalance || 0) - (p.initialBalance || 0)
                    return (
                      <tr key={p._id} className="border-b border-gray-800 hover:bg-dark-700/50">
                        <td className="py-4 px-4 text-white font-medium">{p.userId?.firstName || p.userId?.email || 'Unknown'}</td>
                        <td className="py-4 px-4 text-gray-400">{p.challengeId?.name || 'Challenge'}</td>
                        <td className="py-4 px-4 text-white">${(p.currentBalance || 0).toLocaleString()}</td>
                        <td className={`py-4 px-4 font-medium ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}
                        </td>
                        <td className="py-4 px-4">
                          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs w-fit ${getStatusColor(p.status)}`}>
                            {getStatusIcon(p.status)}
                            {p.status}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-gray-400">{new Date(p.createdAt).toLocaleDateString()}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-1">
                            <button className="p-2 hover:bg-dark-600 rounded-lg transition-colors text-gray-400 hover:text-white" title="View">
                              <Eye size={16} />
                            </button>
                            <button
                              onClick={() => deleteParticipant(p)}
                              className="p-2 hover:bg-dark-600 rounded-lg transition-colors text-gray-400 hover:text-red-500"
                              title="Delete participant"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filteredParticipants.length > PARTICIPANTS_PER_PAGE && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-800">
              <span className="text-gray-500 text-sm">
                Showing {(participantsCurrentPage - 1) * PARTICIPANTS_PER_PAGE + 1}
                –{Math.min(participantsCurrentPage * PARTICIPANTS_PER_PAGE, filteredParticipants.length)} of {filteredParticipants.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setParticipantsPage((pg) => Math.max(1, pg - 1))}
                  disabled={participantsCurrentPage <= 1}
                  className="px-3 py-1.5 rounded-lg text-sm bg-dark-700 text-gray-300 hover:bg-dark-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="text-gray-400 text-sm">Page {participantsCurrentPage} of {participantsTotalPages}</span>
                <button
                  onClick={() => setParticipantsPage((pg) => Math.min(participantsTotalPages, pg + 1))}
                  disabled={participantsCurrentPage >= participantsTotalPages}
                  className="px-3 py-1.5 rounded-lg text-sm bg-dark-700 text-gray-300 hover:bg-dark-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Payouts Tab */}
      {activeTab === 'payouts' && (
        <div className="bg-dark-800 rounded-xl border border-gray-800 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-800">
            <h2 className="text-white font-semibold text-lg">Payout Requests</h2>
            <p className="text-gray-500 text-sm">Approve to credit the trader's wallet with their profit share.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">User</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Account</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Amount</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Status</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Date</th>
                  <th className="text-left text-gray-500 text-sm font-medium py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-500">No payout requests yet</td>
                  </tr>
                ) : (
                  payouts.map((p) => {
                    const statusColor = p.status === 'Pending' ? 'bg-yellow-500/20 text-yellow-500'
                      : (p.status === 'Approved' || p.status === 'Completed') ? 'bg-green-500/20 text-green-500'
                      : 'bg-red-500/20 text-red-500'
                    return (
                      <tr key={p._id} className="border-b border-gray-800 hover:bg-dark-700/50">
                        <td className="py-4 px-4 text-white font-medium">{p.userId?.firstName || p.userId?.email || 'Unknown'}</td>
                        <td className="py-4 px-4 text-gray-400">{p.challengeAccountId?.accountId || '-'}</td>
                        <td className="py-4 px-4 text-yellow-500 font-semibold">${(p.amount || 0).toLocaleString()}</td>
                        <td className="py-4 px-4">
                          <span className={`px-2 py-1 rounded-full text-xs w-fit inline-block ${statusColor}`}>{p.status}</span>
                        </td>
                        <td className="py-4 px-4 text-gray-400">{new Date(p.createdAt).toLocaleDateString()}</td>
                        <td className="py-4 px-4">
                          {p.status === 'Pending' ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => approvePayout(p._id)}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => rejectPayout(p._id)}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Challenge Settings</h2>
              <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Display Name</label>
                <input
                  type="text"
                  value={settings.displayName}
                  onChange={(e) => setSettings({...settings, displayName: e.target.value})}
                  placeholder="Prop Trading Challenge"
                  className="w-full bg-dark-700 border border-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Description</label>
                <textarea
                  value={settings.description}
                  onChange={(e) => setSettings({...settings, description: e.target.value})}
                  placeholder="Trade with our capital..."
                  rows={3}
                  className="w-full bg-dark-700 border border-gray-700 rounded-lg px-4 py-3 text-white resize-none"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Terms & Conditions</label>
                <textarea
                  value={settings.termsAndConditions}
                  onChange={(e) => setSettings({...settings, termsAndConditions: e.target.value})}
                  placeholder="Enter terms and conditions..."
                  rows={5}
                  className="w-full bg-dark-700 border border-gray-700 rounded-lg px-4 py-3 text-white resize-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="flex-1 py-3 bg-dark-700 text-white rounded-lg hover:bg-dark-600"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSettings}
                  className="flex-1 py-3 bg-yellow-500 text-black font-medium rounded-lg hover:bg-yellow-400"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Challenge Create/Edit Modal */}
      {showChallengeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-dark-800 z-10">
              <h2 className="text-xl font-bold text-white">
                {editingChallenge ? 'Edit Challenge' : 'Create New Challenge'}
              </h2>
              <button onClick={() => setShowChallengeModal(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-gray-400 text-sm mb-2">Challenge Name *</label>
                  <select
                    value={challengeForm.name}
                    onChange={(e) => setChallengeForm({...challengeForm, name: e.target.value})}
                    className="w-full bg-dark-700 border border-gray-700 rounded-lg px-4 py-3 text-white"
                  >
                    <option value="" disabled>Select challenge name</option>
                    <option value="Instant Fund">Instant Fund</option>
                    <option value="One Step">One Step</option>
                    <option value="Two Step">Two Step</option>
                    {/* Keep any existing custom name selectable when editing */}
                    {challengeForm.name &&
                      !['Instant Fund', 'One Step', 'Two Step'].includes(challengeForm.name) && (
                        <option value={challengeForm.name}>{challengeForm.name}</option>
                      )}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-gray-400 text-sm mb-2">Description</label>
                  <textarea
                    value={challengeForm.description}
                    onChange={(e) => setChallengeForm({...challengeForm, description: e.target.value})}
                    placeholder="Challenge description..."
                    rows={2}
                    className="w-full bg-dark-700 border border-gray-700 rounded-lg px-4 py-3 text-white resize-none"
                  />
                </div>
              </div>

              {/* Challenge Type & Pricing */}
              <div className="bg-dark-700 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-4">Challenge Type & Pricing</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Challenge Type</label>
                    <select
                      value={challengeForm.stepsCount}
                      onChange={(e) => setChallengeForm({...challengeForm, stepsCount: parseInt(e.target.value)})}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    >
                      <option value={0}>Instant Fund (0-Step)</option>
                      <option value={1}>1-Step Challenge</option>
                      <option value={2}>2-Step Challenge</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Account Size ($)</label>
                    <input
                      type="number"
                      value={challengeForm.fundSize}
                      onChange={(e) => setChallengeForm({...challengeForm, fundSize: parseFloat(e.target.value) || 0})}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Challenge Fee ($)</label>
                    <input
                      type="number"
                      value={challengeForm.challengeFee}
                      onChange={(e) => setChallengeForm({...challengeForm, challengeFee: parseFloat(e.target.value) || 0})}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Drawdown & Profit Rules */}
              <div className="bg-dark-700 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-4">Drawdown & Profit Rules</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Daily Drawdown %</label>
                    <input
                      type="number"
                      value={challengeForm.rules.maxDailyDrawdownPercent}
                      onChange={(e) => updateFormRules('maxDailyDrawdownPercent', parseFloat(e.target.value) || 0)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Overall Drawdown %</label>
                    <input
                      type="number"
                      value={challengeForm.rules.maxOverallDrawdownPercent}
                      onChange={(e) => updateFormRules('maxOverallDrawdownPercent', parseFloat(e.target.value) || 0)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Drawdown Type</label>
                    <select
                      value={challengeForm.rules.drawdownType || 'STATIC'}
                      onChange={(e) => updateFormRules('drawdownType', e.target.value)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    >
                      <option value="STATIC">Static</option>
                      <option value="TRAILING">Trailing</option>
                    </select>
                  </div>
                  {/* Instant Fund (0-Step) has no profit target; hide it */}
                  {challengeForm.stepsCount >= 1 && (
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Phase 1 Target %</label>
                      <input
                        type="number"
                        value={challengeForm.rules.profitTargetPhase1Percent}
                        onChange={(e) => updateFormRules('profitTargetPhase1Percent', parseFloat(e.target.value) || 0)}
                        className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                      />
                    </div>
                  )}
                  {/* Phase 2 target only applies to 2-Step challenges */}
                  {challengeForm.stepsCount >= 2 && (
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Phase 2 Target %</label>
                      <input
                        type="number"
                        value={challengeForm.rules.profitTargetPhase2Percent}
                        onChange={(e) => updateFormRules('profitTargetPhase2Percent', parseFloat(e.target.value) || 0)}
                        className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Live Preview — mirrors the public pricing card based on the form */}
              <div className="bg-dark-700 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-4">Live Preview</h3>
                {(() => {
                  const f = challengeForm
                  const steps = f.stepsCount
                  const typeLabel = steps === 0 ? 'Instant Fund' : steps === 1 ? 'One Step' : 'Two Step'
                  const typeSub = steps === 0 ? 'No Evaluation' : steps === 1 ? 'Single Evaluation' : 'Dual Evaluation'
                  const size = Number(f.fundSize) || 0
                  const sizeLabel = `$${size >= 1000 ? `${size / 1000}K` : size}`
                  const split = f.fundedSettings?.profitSplitPercent ?? 80
                  const lev = f.rules?.maxLeverage ?? 100
                  const dailyP = f.rules?.maxDailyDrawdownPercent ?? 0
                  const ddP = f.rules?.maxOverallDrawdownPercent ?? 0
                  const t1 = f.rules?.profitTargetPhase1Percent ?? 0
                  const t2 = f.rules?.profitTargetPhase2Percent ?? 0
                  const trailing = f.rules?.drawdownType === 'TRAILING' ? ' Trailing' : ''
                  const amt = (p) => `($${Math.round((size * p) / 100).toLocaleString()})`
                  // Quick size presets per challenge type
                  // Instant: 10K/25K/50K · One Step & Two Step: 5K..200K
                  const sizePresets = steps === 0
                    ? [10000, 25000, 50000]
                    : [5000, 15000, 25000, 50000, 100000, 200000]
                  // Auto-fee per size (by type); types without an entry keep the manual fee
                  const feeByType = {
                    0: { 10000: 159, 25000: 299, 50000: 499 },
                    1: { 5000: 70, 15000: 130, 25000: 220, 50000: 333, 100000: 539, 200000: 990 },
                    2: { 5000: 60, 15000: 110, 25000: 199, 50000: 299, 100000: 499, 200000: 900 }
                  }
                  const feeMap = feeByType[steps] || {}
                  const Stat = ({ label, value, sub }) => (
                    <div>
                      <p className="text-gray-500 text-xs mb-0.5">{label}</p>
                      <p className="text-white font-semibold">
                        {value}{sub && <span className="text-gray-500 font-normal ml-1">{sub}</span>}
                      </p>
                    </div>
                  )
                  return (
                    <div className="w-full rounded-2xl border border-gray-700 bg-dark-800 p-6">
                      {/* Size tabs — selecting one sets the Account Size */}
                      {sizePresets.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-5">
                          {sizePresets.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => {
                                const next = { ...challengeForm, fundSize: s }
                                if (feeMap[s] != null) next.challengeFee = feeMap[s]
                                setChallengeForm(next)
                              }}
                              className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                                size === s ? 'bg-yellow-500 text-dark-900' : 'bg-dark-700 text-gray-300 hover:bg-dark-600'
                              }`}
                            >
                              ${s >= 1000 ? `${s / 1000}K` : s}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-start justify-between mb-5">
                        <div>
                          <p className="text-3xl font-bold text-white">{sizeLabel}</p>
                          <p className="text-gray-500 text-xs mt-1">Account Size</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-yellow-500">{typeLabel}</p>
                          <p className="text-gray-500 text-sm">{typeSub}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-y-4 gap-x-3 border-t border-gray-700 pt-4">
                        {Stat({ label: 'Account Size', value: sizeLabel })}
                        {Stat({ label: 'Profit Split', value: `${split}%` })}
                        {Stat({ label: 'Leverage', value: `Upto 1:${lev}` })}
                      </div>
                      <div className="grid grid-cols-3 gap-y-4 gap-x-3 border-t border-gray-700 pt-4 mt-4">
                        {steps >= 1 && Stat({ label: steps === 2 ? 'Profit Target (P1)' : 'Profit Target', value: `${t1}%`, sub: amt(t1) })}
                        {steps === 2 && Stat({ label: 'Profit Target (P2)', value: `${t2}%`, sub: amt(t2) })}
                        {Stat({ label: 'Max.Daily Loss', value: `${dailyP}%${trailing}`, sub: amt(dailyP) })}
                        {Stat({ label: 'Max.Drawdown', value: `${ddP}%${trailing}`, sub: amt(ddP) })}
                      </div>
                      <div className="border-t border-gray-700 mt-4 pt-4">
                        <p className="text-gray-500 text-xs">Challenge Fee</p>
                        <p className="text-2xl font-bold text-yellow-500">${f.challengeFee}</p>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Lot Size & Trade Limits */}
              <div className="bg-dark-700 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-4">Lot Size & Trade Limits</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Min Lot Size</label>
                    <input
                      type="number"
                      step="0.01"
                      value={challengeForm.rules.minLotSize}
                      onChange={(e) => updateFormRules('minLotSize', parseFloat(e.target.value) || 0.01)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Max Lot Size</label>
                    <input
                      type="number"
                      value={challengeForm.rules.maxLotSize}
                      onChange={(e) => updateFormRules('maxLotSize', parseFloat(e.target.value) || 100)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Min Trades Required</label>
                    <input
                      type="number"
                      value={challengeForm.rules.minTradesRequired || ''}
                      onChange={(e) => updateFormRules('minTradesRequired', parseInt(e.target.value) || null)}
                      placeholder="No limit"
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Max Trades/Day</label>
                    <input
                      type="number"
                      value={challengeForm.rules.maxTradesPerDay || ''}
                      onChange={(e) => updateFormRules('maxTradesPerDay', parseInt(e.target.value) || null)}
                      placeholder="No limit"
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Max Total Trades</label>
                    <input
                      type="number"
                      value={challengeForm.rules.maxTotalTrades || ''}
                      onChange={(e) => updateFormRules('maxTotalTrades', parseInt(e.target.value) || null)}
                      placeholder="No limit"
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Max Concurrent</label>
                    <input
                      type="number"
                      value={challengeForm.rules.maxConcurrentTrades || ''}
                      onChange={(e) => updateFormRules('maxConcurrentTrades', parseInt(e.target.value) || null)}
                      placeholder="No limit"
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Max Leverage</label>
                    <input
                      type="number"
                      value={challengeForm.rules.maxLeverage}
                      onChange={(e) => updateFormRules('maxLeverage', parseInt(e.target.value) || 100)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Min Hold Time (sec)</label>
                    <input
                      type="number"
                      value={challengeForm.rules.minTradeHoldTimeSeconds}
                      onChange={(e) => updateFormRules('minTradeHoldTimeSeconds', parseInt(e.target.value) || 0)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Time & Duration */}
              <div className="bg-dark-700 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-4">Time & Duration</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Challenge Duration (days)</label>
                    <input
                      type="number"
                      value={challengeForm.rules.challengeExpiryDays}
                      onChange={(e) => updateFormRules('challengeExpiryDays', parseInt(e.target.value) || 30)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Min Trading Days</label>
                    <input
                      type="number"
                      value={challengeForm.rules.tradingDaysRequired || ''}
                      onChange={(e) => updateFormRules('tradingDaysRequired', parseInt(e.target.value) || null)}
                      placeholder="No minimum"
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">Profit Split %</label>
                    <input
                      type="number"
                      value={challengeForm.fundedSettings.profitSplitPercent}
                      onChange={(e) => updateFormFunded('profitSplitPercent', parseInt(e.target.value) || 80)}
                      className="w-full bg-dark-600 border border-gray-600 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Trading Rules Toggles */}
              <div className="bg-dark-700 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-4">Trading Rules</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={challengeForm.rules.stopLossMandatory}
                      onChange={(e) => updateFormRules('stopLossMandatory', e.target.checked)}
                      className="w-5 h-5 rounded bg-dark-600 border-gray-600 text-yellow-500"
                    />
                    <span className="text-white text-sm">Stop Loss Required</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={challengeForm.rules.takeProfitMandatory}
                      onChange={(e) => updateFormRules('takeProfitMandatory', e.target.checked)}
                      className="w-5 h-5 rounded bg-dark-600 border-gray-600 text-yellow-500"
                    />
                    <span className="text-white text-sm">Take Profit Required</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={challengeForm.rules.allowWeekendHolding}
                      onChange={(e) => updateFormRules('allowWeekendHolding', e.target.checked)}
                      className="w-5 h-5 rounded bg-dark-600 border-gray-600 text-yellow-500"
                    />
                    <span className="text-white text-sm">Weekend Holding</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={challengeForm.rules.allowNewsTrading}
                      onChange={(e) => updateFormRules('allowNewsTrading', e.target.checked)}
                      className="w-5 h-5 rounded bg-dark-600 border-gray-600 text-yellow-500"
                    />
                    <span className="text-white text-sm">News Trading</span>
                  </label>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={challengeForm.isActive}
                    onChange={(e) => setChallengeForm({...challengeForm, isActive: e.target.checked})}
                    className="w-5 h-5 rounded bg-dark-600 border-gray-600 text-yellow-500"
                  />
                  <span className="text-white">Active (visible to users)</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-gray-700">
                <button
                  onClick={() => setShowChallengeModal(false)}
                  className="flex-1 py-3 bg-dark-700 text-white rounded-lg hover:bg-dark-600"
                >
                  Cancel
                </button>
                <button
                  onClick={saveChallenge}
                  className="flex-1 py-3 bg-yellow-500 text-black font-medium rounded-lg hover:bg-yellow-400"
                >
                  {editingChallenge ? 'Update Challenge' : 'Create Challenge'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

export default AdminPropFirm
