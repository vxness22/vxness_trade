import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import AdminLayout from '../components/AdminLayout'
import { 
  Gift, 
  Check, 
  X, 
  Clock, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Search,
  Filter,
  Plus,
  Minus
} from 'lucide-react'
import { API_URL } from '../config/api'
import { useTheme } from '../context/ThemeContext'

const AdminCreditRequests = () => {
  const { isDarkMode } = useTheme()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [actionLoading, setActionLoading] = useState(null)
  const [rejectNote, setRejectNote] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(null)
  
  // Credit In/Out Modal State
  const [showCreditModal, setShowCreditModal] = useState(false)
  const [creditType, setCreditType] = useState('in') // 'in' or 'out'
  const [creditForm, setCreditForm] = useState({ userId: '', accountId: '', amount: '', reason: '' })
  const [users, setUsers] = useState([])
  const [userAccounts, setUserAccounts] = useState([])
  const [creditLoading, setCreditLoading] = useState(false)

  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}')

  useEffect(() => {
    fetchCreditRequests()
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/users`)
      const data = await res.json()
      if (data.users) {
        setUsers(data.users)
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchUserAccounts = async (userId) => {
    try {
      const res = await fetch(`${API_URL}/trading-accounts/user/${userId}`)
      const data = await res.json()
      if (data.success && data.accounts) {
        setUserAccounts(data.accounts)
      } else {
        setUserAccounts([])
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
      setUserAccounts([])
    }
  }

  const openCreditModal = (type) => {
    setCreditType(type)
    setCreditForm({ userId: '', accountId: '', amount: '', reason: '' })
    setUserAccounts([])
    setShowCreditModal(true)
  }

  const handleCreditSubmit = async () => {
    if (!creditForm.accountId || !creditForm.amount) {
      toast.error('Please fill all required fields')
      return
    }

    const amount = parseFloat(creditForm.amount)
    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    setCreditLoading(true)
    try {
      const res = await fetch(`${API_URL}/admin/credit/${creditType === 'in' ? 'add' : 'remove'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradingAccountId: creditForm.accountId,
          amount: amount,
          reason: creditForm.reason || (creditType === 'in' ? 'Admin Credit In' : 'Admin Credit Out'),
          adminId: adminUser._id,
          creditRequestId: creditForm.creditRequestId || null
        })
      })
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.message || `Server error: ${res.status}`)
        setCreditLoading(false)
        return
      }
      
      const data = await res.json()
      if (data.success) {
        toast.success(`Credit ${creditType === 'in' ? 'added' : 'removed'} successfully! New Credit: $${data.newCredit?.toFixed(2) || '0.00'}`)
        setShowCreditModal(false)
        setCreditForm({ userId: '', accountId: '', amount: '', reason: '' })
        fetchCreditRequests()
      } else {
        toast.error(data.message || `Failed to ${creditType === 'in' ? 'add' : 'remove'} credit`)
      }
    } catch (error) {
      console.error('Credit error:', error)
      toast.error(`Error ${creditType === 'in' ? 'adding' : 'removing'} credit: ${error.message}`)
    }
    setCreditLoading(false)
  }

  const fetchCreditRequests = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/admin/credit-requests`)
      const data = await res.json()
      if (data.success) {
        setRequests(data.requests || [])
      }
    } catch (error) {
      console.error('Error fetching credit requests:', error)
      toast.error('Failed to fetch credit requests')
    }
    setLoading(false)
  }

  const handleApprove = async (requestId) => {
    setActionLoading(requestId)
    try {
      const res = await fetch(`${API_URL}/admin/credit-requests/${requestId}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: adminUser._id })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Credit request approved!')
        fetchCreditRequests()
      } else {
        toast.error(data.message || 'Failed to approve')
      }
    } catch (error) {
      toast.error('Error approving request')
    }
    setActionLoading(null)
  }

  const handleReject = async (requestId) => {
    setActionLoading(requestId)
    try {
      const res = await fetch(`${API_URL}/admin/credit-requests/${requestId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: adminUser._id, adminNote: rejectNote })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Credit request rejected')
        setShowRejectModal(null)
        setRejectNote('')
        fetchCreditRequests()
      } else {
        toast.error(data.message || 'Failed to reject')
      }
    } catch (error) {
      toast.error('Error rejecting request')
    }
    setActionLoading(null)
  }

  const filteredRequests = requests.filter(req => {
    const matchesFilter = filter === 'all' || req.status.toLowerCase() === filter
    const matchesSearch = !searchTerm || 
      req.userId?.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.userId?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.tradingAccountName?.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const stats = {
    total: requests.length,
    pending: requests.filter(r => r.status === 'Pending').length,
    approved: requests.filter(r => r.status === 'Approved').length,
    rejected: requests.filter(r => r.status === 'Rejected').length
  }

  // Open Credit In/Out modal for any user (top-level action)
  const openNewCreditModal = (type) => {
    setCreditType(type)
    setCreditForm({ userId: '', accountId: '', accountName: '', amount: '', reason: '', isNewCredit: true })
    setUserAccounts([])
    setShowCreditModal(true)
  }

  return (
    <AdminLayout title="Credit Requests" subtitle="Manage user credit deposit requests">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200'}`}>
          <p className="text-gray-500 text-sm">Total Requests</p>
          <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{stats.total}</p>
        </div>
        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200'}`}>
          <p className="text-yellow-500 text-sm">Pending</p>
          <p className="text-2xl font-bold text-yellow-500">{stats.pending}</p>
        </div>
        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200'}`}>
          <p className="text-green-500 text-sm">Approved</p>
          <p className="text-2xl font-bold text-green-500">{stats.approved}</p>
        </div>
        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200'}`}>
          <p className="text-red-500 text-sm">Rejected</p>
          <p className="text-2xl font-bold text-red-500">{stats.rejected}</p>
        </div>
      </div>

      {/* Filters */}
      <div className={`p-4 rounded-xl border mb-6 ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200'}`}>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by user name, email, or account..."
              className={`w-full pl-10 pr-4 py-2.5 rounded-lg border focus:outline-none focus:border-purple-500 ${isDarkMode ? 'bg-dark-700 border-gray-700 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'}`}
            />
          </div>
          <div className="flex gap-2">
            {['all', 'pending', 'approved', 'rejected'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                  filter === f
                    ? 'bg-purple-500 text-white'
                    : isDarkMode 
                      ? 'bg-dark-700 text-gray-400 hover:text-white' 
                      : 'bg-gray-100 text-gray-600 hover:text-gray-900'
                }`}
              >
                {f}
              </button>
            ))}
            <button
              onClick={fetchCreditRequests}
              className={`px-3 py-2 rounded-lg transition-colors ${isDarkMode ? 'bg-dark-700 text-gray-400 hover:text-white' : 'bg-gray-100 text-gray-600 hover:text-gray-900'}`}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Requests Table */}
      <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-dark-800 border-gray-800' : 'bg-white border-gray-200'}`}>
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading credit requests...</div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Gift size={40} className="mx-auto mb-3 opacity-50" />
            <p>No credit requests found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${isDarkMode ? 'border-gray-700 bg-dark-700' : 'border-gray-200 bg-gray-50'}`}>
                  <th className={`text-left px-4 py-3 text-xs font-medium uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>User</th>
                  <th className={`text-left px-4 py-3 text-xs font-medium uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Account</th>
                  <th className={`text-left px-4 py-3 text-xs font-medium uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Amount</th>
                  <th className={`text-left px-4 py-3 text-xs font-medium uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Reason</th>
                  <th className={`text-left px-4 py-3 text-xs font-medium uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Status</th>
                  <th className={`text-left px-4 py-3 text-xs font-medium uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Date</th>
                  <th className={`text-left px-4 py-3 text-xs font-medium uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Actions</th>
                  <th className={`text-left px-4 py-3 text-xs font-medium uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map(req => (
                  <tr key={req._id} className={`border-b ${isDarkMode ? 'border-gray-800 hover:bg-dark-700' : 'border-gray-100 hover:bg-gray-50'}`}>
                    <td className="px-4 py-3">
                      <p className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{req.userId?.firstName || 'N/A'}</p>
                      <p className="text-gray-500 text-xs">{req.userId?.email || 'N/A'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className={`text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{req.tradingAccountName || req.tradingAccountId?.accountId || 'N/A'}</p>
                      <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs font-medium">
                        Credit: ${(req.tradingAccountId?.credit || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium">
                          Request: ${req.amount.toLocaleString()}
                        </span>
                        {req.additionalCreditIn > 0 && (
                          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium">
                            + In: ${req.additionalCreditIn.toLocaleString()}
                          </span>
                        )}
                        {req.additionalCreditOut > 0 && (
                          <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-medium">
                            - Out: ${req.additionalCreditOut.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{req.reason || '-'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        req.status === 'Pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        req.status === 'Approved' ? 'bg-green-500/20 text-green-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {req.status === 'Pending' && <Clock size={12} />}
                        {req.status === 'Approved' && <CheckCircle size={12} />}
                        {req.status === 'Rejected' && <XCircle size={12} />}
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {new Date(req.createdAt).toLocaleDateString()}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {new Date(req.createdAt).toLocaleTimeString()}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {req.status === 'Pending' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(req._id)}
                            disabled={actionLoading === req._id}
                            className="px-3 py-1.5 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            <Check size={12} /> Approve
                          </button>
                          <button
                            onClick={() => setShowRejectModal(req._id)}
                            disabled={actionLoading === req._id}
                            className="px-3 py-1.5 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            <X size={12} /> Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-500 text-xs">
                          {req.processedAt ? `Processed ${new Date(req.processedAt).toLocaleDateString()}` : 'Processed'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const accId = typeof req.tradingAccountId === 'object' ? req.tradingAccountId?._id : req.tradingAccountId
                            const userId = typeof req.userId === 'object' ? req.userId?._id : req.userId
                            setCreditType('in')
                            setCreditForm({ 
                              userId: userId || '', 
                              accountId: accId || '', 
                              accountName: req.tradingAccountName || req.tradingAccountId?.accountId || '',
                              amount: '', 
                              reason: '',
                              isNewCredit: false,
                              creditRequestId: req._id
                            })
                            setUserAccounts(req.tradingAccountId ? [req.tradingAccountId] : [])
                            setShowCreditModal(true)
                          }}
                          className="px-2 py-1 bg-green-500/20 text-green-500 rounded text-xs font-medium hover:bg-green-500/30 transition-colors flex items-center gap-1"
                          title="Credit In"
                        >
                          <Plus size={12} /> In
                        </button>
                        <button
                          onClick={() => {
                            const accId = typeof req.tradingAccountId === 'object' ? req.tradingAccountId?._id : req.tradingAccountId
                            const userId = typeof req.userId === 'object' ? req.userId?._id : req.userId
                            setCreditType('out')
                            setCreditForm({ 
                              userId: userId || '', 
                              accountId: accId || '', 
                              accountName: req.tradingAccountName || req.tradingAccountId?.accountId || '',
                              amount: '', 
                              reason: '',
                              isNewCredit: false,
                              creditRequestId: req._id
                            })
                            setUserAccounts(req.tradingAccountId ? [req.tradingAccountId] : [])
                            setShowCreditModal(true)
                          }}
                          className="px-2 py-1 bg-red-500/20 text-red-500 rounded text-xs font-medium hover:bg-red-500/30 transition-colors flex items-center gap-1"
                          title="Credit Out"
                        >
                          <Minus size={12} /> Out
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`rounded-xl p-6 w-full max-w-md border ${isDarkMode ? 'bg-dark-800 border-gray-700' : 'bg-white border-gray-300'}`}>
            <h3 className={`font-semibold text-lg mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Reject Credit Request</h3>
            <div className="mb-4">
              <label className={`block text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Rejection Note (Optional)</label>
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Enter reason for rejection..."
                rows={3}
                className={`w-full border rounded-lg px-4 py-3 placeholder-gray-500 focus:outline-none focus:border-red-500 ${isDarkMode ? 'bg-dark-700 border-gray-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowRejectModal(null); setRejectNote(''); }}
                className={`flex-1 py-3 rounded-lg transition-colors ${isDarkMode ? 'bg-dark-700 text-white hover:bg-dark-600' : 'bg-gray-200 text-gray-900 hover:bg-gray-300'}`}
              >
                Cancel
              </button>
              <button
                onClick={() => handleReject(showRejectModal)}
                disabled={actionLoading === showRejectModal}
                className="flex-1 py-3 bg-red-500 text-white font-medium rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {actionLoading === showRejectModal ? 'Rejecting...' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credit In/Out Modal */}
      {showCreditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`rounded-xl p-6 w-full max-w-md border ${isDarkMode ? 'bg-dark-800 border-gray-700' : 'bg-white border-gray-300'}`}>
            <div className="flex items-center gap-3 mb-6">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${creditType === 'in' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                {creditType === 'in' ? <Plus size={20} className="text-green-500" /> : <Minus size={20} className="text-red-500" />}
              </div>
              <div>
                <h3 className={`font-semibold text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {creditType === 'in' ? 'Credit In' : 'Credit Out'}
                </h3>
                <p className="text-gray-500 text-sm">
                  {creditType === 'in' ? 'Add credit to user account' : 'Remove credit from user account'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Show User/Account dropdowns if opened from top buttons (isNewCredit) */}
              {creditForm.isNewCredit ? (
                <>
                  {/* User Select */}
                  <div>
                    <label className={`block text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Select User *</label>
                    <select
                      value={creditForm.userId}
                      onChange={(e) => {
                        setCreditForm({ ...creditForm, userId: e.target.value, accountId: '' })
                        if (e.target.value) fetchUserAccounts(e.target.value)
                      }}
                      className={`w-full border rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 ${isDarkMode ? 'bg-dark-700 border-gray-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                    >
                      <option value="">Select a user...</option>
                      {users.map(u => (
                        <option key={u._id} value={u._id}>{u.firstName} {u.lastName} - {u.email}</option>
                      ))}
                    </select>
                  </div>

                  {/* Account Select */}
                  <div>
                    <label className={`block text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Select Account *</label>
                    <select
                      value={creditForm.accountId}
                      onChange={(e) => setCreditForm({ ...creditForm, accountId: e.target.value })}
                      disabled={!creditForm.userId}
                      className={`w-full border rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 disabled:opacity-50 ${isDarkMode ? 'bg-dark-700 border-gray-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                    >
                      <option value="">Select an account...</option>
                      {userAccounts.map(acc => (
                        <option key={acc._id} value={acc._id}>
                          {acc.accountId} - Balance: ${acc.balance?.toFixed(2)} | Credit: ${acc.credit?.toFixed(2) || '0.00'}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                /* Show Account Info if opened from row buttons */
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-dark-700' : 'bg-gray-100'}`}>
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-500 text-sm">Account:</span>
                    <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {userAccounts[0]?.accountId || creditForm.accountName || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-sm">Current Credit:</span>
                    <span className="text-purple-400 font-medium">
                      ${(userAccounts[0]?.credit || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Amount */}
              <div>
                <label className={`block text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Amount ($) *</label>
                <input
                  type="number"
                  value={creditForm.amount}
                  onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })}
                  placeholder="Enter amount..."
                  min="0"
                  step="0.01"
                  className={`w-full border rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 ${isDarkMode ? 'bg-dark-700 border-gray-700 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'}`}
                />
              </div>

              {/* Reason */}
              <div>
                <label className={`block text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Reason (Optional)</label>
                <input
                  type="text"
                  value={creditForm.reason}
                  onChange={(e) => setCreditForm({ ...creditForm, reason: e.target.value })}
                  placeholder={creditType === 'in' ? 'e.g., Loan, Bonus, Promotion...' : 'e.g., Loan Repayment, Adjustment...'}
                  className={`w-full border rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 ${isDarkMode ? 'bg-dark-700 border-gray-700 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'}`}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCreditModal(false); setCreditForm({ userId: '', accountId: '', amount: '', reason: '' }); }}
                className={`flex-1 py-3 rounded-lg transition-colors ${isDarkMode ? 'bg-dark-700 text-white hover:bg-dark-600' : 'bg-gray-200 text-gray-900 hover:bg-gray-300'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleCreditSubmit}
                disabled={creditLoading}
                className={`flex-1 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
                  creditType === 'in' 
                    ? 'bg-green-500 text-white hover:bg-green-600' 
                    : 'bg-red-500 text-white hover:bg-red-600'
                }`}
              >
                {creditLoading ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : creditType === 'in' ? (
                  <><Plus size={16} /> Add Credit</>
                ) : (
                  <><Minus size={16} /> Remove Credit</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

export default AdminCreditRequests
