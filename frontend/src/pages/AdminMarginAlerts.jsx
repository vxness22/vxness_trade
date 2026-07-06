import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import AdminLayout from '../components/AdminLayout'
import { API_URL } from '../config/api'
import { confirmToast } from '../utils/dialogs'
import { 
  AlertTriangle,
  Bell,
  Phone,
  Mail,
  Plus,
  Edit,
  Trash2,
  Check,
  X,
  RefreshCw,
  Search,
  User,
  Wallet,
  TrendingDown,
  Clock,
  CheckCircle,
  XCircle
} from 'lucide-react'

const AdminMarginAlerts = () => {
  const [alerts, setAlerts] = useState([])
  const [triggeredAlerts, setTriggeredAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all') // all, triggered
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('create') // create, edit
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  
  // Form state
  const [formData, setFormData] = useState({
    accountId: '',
    marginThreshold: 50,
    notes: '',
    contactPreference: 'notification_only'
  })
  
  // All accounts for dropdown
  const [allAccounts, setAllAccounts] = useState([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState(null)
  
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}')

  useEffect(() => {
    fetchAlerts()
    fetchTriggeredAlerts()
    fetchAllAccounts()
  }, [])

  const fetchAlerts = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/margin-alerts`)
      if (response.ok) {
        const data = await response.json()
        setAlerts(data.alerts || [])
      }
    } catch (error) {
      console.error('Error fetching margin alerts:', error)
      toast.error('Failed to fetch margin alerts')
    }
    setLoading(false)
  }

  const fetchTriggeredAlerts = async () => {
    try {
      const response = await fetch(`${API_URL}/margin-alerts/triggered`)
      if (response.ok) {
        const data = await response.json()
        setTriggeredAlerts(data.alerts || [])
      }
    } catch (error) {
      console.error('Error fetching triggered alerts:', error)
    }
  }

  const fetchAllAccounts = async () => {
    setLoadingAccounts(true)
    try {
      const response = await fetch(`${API_URL}/trading-accounts/all`)
      if (response.ok) {
        const data = await response.json()
        setAllAccounts(data.accounts || [])
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
    setLoadingAccounts(false)
  }

  const handleCreateAlert = async () => {
    if (!selectedAccount) {
      toast.error('Please select a trading account')
      return
    }
    
    if (formData.marginThreshold < 1 || formData.marginThreshold > 100) {
      toast.error('Margin threshold must be between 1 and 100')
      return
    }

    try {
      const response = await fetch(`${API_URL}/margin-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount._id,
          marginThreshold: formData.marginThreshold,
          notes: formData.notes,
          contactPreference: formData.contactPreference,
          adminId: adminUser._id
        })
      })
      
      const data = await response.json()
      if (data.success) {
        toast.success('Margin alert created successfully')
        fetchAlerts()
        closeModal()
      } else {
        toast.error(data.message || 'Failed to create alert')
      }
    } catch (error) {
      console.error('Error creating alert:', error)
      toast.error('Failed to create alert')
    }
  }

  const handleUpdateAlert = async () => {
    if (!selectedAlert) return

    try {
      const response = await fetch(`${API_URL}/margin-alerts/${selectedAlert._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marginThreshold: formData.marginThreshold,
          notes: formData.notes,
          contactPreference: formData.contactPreference,
          isActive: formData.isActive
        })
      })
      
      const data = await response.json()
      if (data.success) {
        toast.success('Margin alert updated successfully')
        fetchAlerts()
        closeModal()
      } else {
        toast.error(data.message || 'Failed to update alert')
      }
    } catch (error) {
      console.error('Error updating alert:', error)
      toast.error('Failed to update alert')
    }
  }

  const handleDeleteAlert = async (alertId) => {
    if (!(await confirmToast('Are you sure you want to delete this margin alert?'))) return

    try {
      const response = await fetch(`${API_URL}/margin-alerts/${alertId}`, {
        method: 'DELETE'
      })
      
      const data = await response.json()
      if (data.success) {
        toast.success('Margin alert deleted')
        fetchAlerts()
      } else {
        toast.error(data.message || 'Failed to delete alert')
      }
    } catch (error) {
      console.error('Error deleting alert:', error)
      toast.error('Failed to delete alert')
    }
  }

  const handleAcknowledge = async (alertId) => {
    try {
      const response = await fetch(`${API_URL}/margin-alerts/${alertId}/acknowledge`, {
        method: 'POST'
      })
      
      const data = await response.json()
      if (data.success) {
        toast.success('Alert acknowledged')
        fetchTriggeredAlerts()
        fetchAlerts()
      }
    } catch (error) {
      console.error('Error acknowledging alert:', error)
      toast.error('Failed to acknowledge alert')
    }
  }

  const handleCheckMargins = async () => {
    try {
      const response = await fetch(`${API_URL}/margin-alerts/check-margins`)
      const data = await response.json()
      if (data.success) {
        toast.success(`Checked ${data.totalChecked} alerts, ${data.totalTriggered} triggered`)
        fetchTriggeredAlerts()
        fetchAlerts()
      }
    } catch (error) {
      console.error('Error checking margins:', error)
      toast.error('Failed to check margins')
    }
  }

  const openCreateModal = () => {
    setModalMode('create')
    setFormData({
      accountId: '',
      marginThreshold: 50,
      notes: '',
      contactPreference: 'notification_only'
    })
    setSelectedAccount(null)
    setShowModal(true)
  }

  const openEditModal = (alert) => {
    setModalMode('edit')
    setSelectedAlert(alert)
    setFormData({
      marginThreshold: alert.marginThreshold,
      notes: alert.notes || '',
      contactPreference: alert.contactPreference,
      isActive: alert.isActive
    })
    setSelectedAccount(alert.accountId)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setSelectedAlert(null)
    setSelectedAccount(null)
  }

  const filteredAlerts = alerts.filter(alert => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      alert.accountId?.accountId?.toLowerCase().includes(search) ||
      alert.userId?.firstName?.toLowerCase().includes(search) ||
      alert.userId?.email?.toLowerCase().includes(search)
    )
  })

  const getContactIcon = (preference) => {
    switch (preference) {
      case 'call': return <Phone size={14} className="text-blue-500" />
      case 'email': return <Mail size={14} className="text-green-500" />
      case 'both': return <><Phone size={14} className="text-blue-500" /><Mail size={14} className="text-green-500" /></>
      default: return <Bell size={14} className="text-yellow-500" />
    }
  }

  return (
    <AdminLayout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <AlertTriangle className="text-yellow-500" /> Margin Alerts
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Set margin thresholds to get notified when users need attention
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCheckMargins}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <RefreshCw size={16} /> Check Margins
            </button>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-accent-green hover:bg-accent-green/90 text-black font-medium rounded-lg transition-colors"
            >
              <Plus size={16} /> Add Alert
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-800">
          <button
            onClick={() => setActiveTab('all')}
            className={`pb-3 px-1 text-sm font-medium transition-colors ${
              activeTab === 'all' 
                ? 'text-accent-green border-b-2 border-accent-green' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            All Alerts ({alerts.length})
          </button>
          <button
            onClick={() => setActiveTab('triggered')}
            className={`pb-3 px-1 text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'triggered' 
                ? 'text-red-500 border-b-2 border-red-500' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Bell size={14} className={triggeredAlerts.length > 0 ? 'animate-pulse' : ''} />
            Triggered ({triggeredAlerts.length})
          </button>
        </div>

        {/* Search */}
        {activeTab === 'all' && (
          <div className="mb-4">
            <div className="relative max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search by account ID, name, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-dark-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-accent-green"
              />
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={24} className="animate-spin text-accent-green" />
          </div>
        ) : activeTab === 'all' ? (
          /* All Alerts Table */
          <div className="bg-dark-800 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400 text-sm font-medium">Account</th>
                  <th className="text-left py-3 px-4 text-gray-400 text-sm font-medium">User</th>
                  <th className="text-left py-3 px-4 text-gray-400 text-sm font-medium">Threshold</th>
                  <th className="text-left py-3 px-4 text-gray-400 text-sm font-medium">Contact</th>
                  <th className="text-left py-3 px-4 text-gray-400 text-sm font-medium">Status</th>
                  <th className="text-left py-3 px-4 text-gray-400 text-sm font-medium">Triggers</th>
                  <th className="text-left py-3 px-4 text-gray-400 text-sm font-medium">Notes</th>
                  <th className="text-right py-3 px-4 text-gray-400 text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="text-center py-8 text-gray-500">
                      No margin alerts found
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((alert) => (
                    <tr key={alert._id} className="border-b border-gray-800 hover:bg-dark-700/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Wallet size={14} className="text-gray-500" />
                          <span className="text-white font-mono">{alert.accountId?.accountId || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div>
                          <p className="text-white text-sm">{alert.userId?.firstName || 'N/A'}</p>
                          <p className="text-gray-500 text-xs">{alert.userId?.email}</p>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-yellow-500 font-bold">{alert.marginThreshold}%</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          {getContactIcon(alert.contactPreference)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {alert.isActive ? (
                          <span className="flex items-center gap-1 text-green-500 text-sm">
                            <CheckCircle size={14} /> Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-gray-500 text-sm">
                            <XCircle size={14} /> Inactive
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-400">{alert.triggerCount}</span>
                        {alert.lastTriggeredAt && (
                          <p className="text-xs text-gray-600">
                            Last: {new Date(alert.lastTriggeredAt).toLocaleDateString()}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-gray-400 text-sm truncate max-w-[150px]" title={alert.notes}>
                          {alert.notes || '-'}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(alert)}
                            className="p-1.5 hover:bg-dark-600 rounded text-gray-400 hover:text-white"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteAlert(alert._id)}
                            className="p-1.5 hover:bg-dark-600 rounded text-gray-400 hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Triggered Alerts */
          <div className="space-y-4">
            {triggeredAlerts.length === 0 ? (
              <div className="bg-dark-800 rounded-xl border border-gray-800 p-8 text-center">
                <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
                <p className="text-gray-400">No triggered alerts at the moment</p>
              </div>
            ) : (
              triggeredAlerts.map((alert) => (
                <div key={alert._id} className="bg-dark-800 rounded-xl border border-red-500/50 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-red-500/20 rounded-lg">
                        <AlertTriangle size={24} className="text-red-500" />
                      </div>
                      <div>
                        <h3 className="text-white font-medium flex items-center gap-2">
                          Account: {alert.accountId?.accountId}
                          <span className="text-red-500 text-sm">({alert.marginThreshold}% threshold)</span>
                        </h3>
                        <p className="text-gray-400 text-sm mt-1">
                          User: {alert.userId?.firstName} ({alert.userId?.email})
                        </p>
                        {alert.userId?.phone && (
                          <p className="text-blue-400 text-sm flex items-center gap-1 mt-1">
                            <Phone size={12} /> {alert.userId?.countryCode} {alert.userId?.phone}
                          </p>
                        )}
                        {alert.notes && (
                          <p className="text-yellow-500 text-sm mt-2 flex items-center gap-1">
                            <Bell size={12} /> {alert.notes}
                          </p>
                        )}
                        <p className="text-gray-600 text-xs mt-2">
                          Triggered: {new Date(alert.lastTriggeredAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAcknowledge(alert._id)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                    >
                      <Check size={16} /> Acknowledge
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-dark-800 rounded-xl border border-gray-700 w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">
                  {modalMode === 'create' ? 'Create Margin Alert' : 'Edit Margin Alert'}
                </h2>
                <button onClick={closeModal} className="text-gray-400 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Account Selection (only for create) */}
                {modalMode === 'create' && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Select Trading Account</label>
                    <select
                      value={selectedAccount?._id || ''}
                      onChange={(e) => {
                        const account = allAccounts.find(a => a._id === e.target.value)
                        setSelectedAccount(account || null)
                      }}
                      className="w-full px-4 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent-green"
                    >
                      <option value="">-- Select Account --</option>
                      {allAccounts.map((account) => (
                        <option key={account._id} value={account._id}>
                          {account.accountId} - {account.userId?.firstName || 'N/A'} ({account.userId?.email || 'N/A'}) - ${account.balance?.toFixed(2)}
                        </option>
                      ))}
                    </select>
                    {selectedAccount && (
                      <div className="mt-2 p-3 bg-dark-700 rounded-lg border border-green-600">
                        <p className="text-white font-mono text-sm">Account: {selectedAccount.accountId}</p>
                        <p className="text-gray-400 text-xs">User: {selectedAccount.userId?.firstName} ({selectedAccount.userId?.email})</p>
                        <p className="text-gray-400 text-xs">Balance: ${selectedAccount.balance?.toFixed(2)} | Leverage: {selectedAccount.leverage || 'N/A'}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Margin Threshold */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Margin Threshold (%)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formData.marginThreshold}
                    onChange={(e) => setFormData({ ...formData, marginThreshold: parseInt(e.target.value) || 50 })}
                    className="w-full px-4 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent-green"
                  />
                  <p className="text-gray-500 text-xs mt-1">
                    Alert when margin level drops to or below this percentage
                  </p>
                </div>

                {/* Contact Preference */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Contact Preference</label>
                  <select
                    value={formData.contactPreference}
                    onChange={(e) => setFormData({ ...formData, contactPreference: e.target.value })}
                    className="w-full px-4 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent-green"
                  >
                    <option value="notification_only">Notification Only</option>
                    <option value="call">Call User</option>
                    <option value="email">Email User</option>
                    <option value="both">Call & Email</option>
                  </select>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Notes (for admin)</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="e.g., Call immediately, VIP client..."
                    rows={3}
                    className="w-full px-4 py-2 bg-dark-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-accent-green resize-none"
                  />
                </div>

                {/* Active Toggle (only for edit) */}
                {modalMode === 'edit' && (
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-400">Alert Active</label>
                    <button
                      onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                      className={`w-12 h-6 rounded-full transition-colors ${
                        formData.isActive ? 'bg-accent-green' : 'bg-gray-600'
                      }`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                        formData.isActive ? 'translate-x-6' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={modalMode === 'create' ? handleCreateAlert : handleUpdateAlert}
                  className="flex-1 px-4 py-2 bg-accent-green hover:bg-accent-green/90 text-black font-medium rounded-lg transition-colors"
                >
                  {modalMode === 'create' ? 'Create Alert' : 'Update Alert'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminMarginAlerts
