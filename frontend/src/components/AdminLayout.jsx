import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  Users,
  LogOut,
  TrendingUp,
  Wallet,
  Building2,
  UserCog,
  DollarSign,
  IndianRupee,
  Copy,
  Trophy,
  CreditCard,
  Shield,
  FileCheck,
  HeadphonesIcon,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Palette,
  Mail,
  Gift,
  Sun,
  Moon,
  LineChart,
  Eye,
  AlertTriangle
} from 'lucide-react'
import logoImage from '../assets/logo.png'
import { useTheme } from '../context/ThemeContext'

const AdminLayout = ({ children, title, subtitle }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { isDarkMode, toggleDarkMode } = useTheme()
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState({})

  const menuItems = [
    { name: 'Overview Dashboard', icon: LayoutDashboard, path: '/admin/dashboard' },
    { name: 'User Management', icon: Users, path: '/admin/users' },
    { name: 'Trade Management', icon: TrendingUp, path: '/admin/trades' },
    { name: 'Fund Management', icon: Wallet, path: '/admin/funds' },
    { name: 'Credit Requests', icon: Gift, path: '/admin/credit-requests' },
    { name: 'Bank Settings', icon: Building2, path: '/admin/bank-settings' },
    { name: 'IB Management', icon: UserCog, path: '/admin/ib-management' },
    { name: 'Forex Charges', icon: DollarSign, path: '/admin/forex-charges' },
    { name: 'Earnings Report', icon: TrendingUp, path: '/admin/earnings' },
    { name: 'Copy Trade Management', icon: Copy, path: '/admin/copy-trade' },
    { name: 'Prop Firm Challenges', icon: Trophy, path: '/admin/prop-firm' },
    { name: 'Account Types', icon: CreditCard, path: '/admin/account-types' },
    { name: 'Investor Access', icon: Eye, path: '/admin/investor-access' },
    { name: 'Margin Alerts', icon: AlertTriangle, path: '/admin/margin-alerts' },
    { name: 'Theme Settings', icon: Palette, path: '/admin/theme' },
    { name: 'Email Templates', icon: Mail, path: '/admin/email-templates' },
    { name: 'Bonus Management', icon: Gift, path: '/admin/bonus-management' },
    { name: 'Admin Management', icon: Shield, path: '/admin/admin-management' },
    { name: 'KYC Verification', icon: FileCheck, path: '/admin/kyc' },
    { name: 'Support Tickets', icon: HeadphonesIcon, path: '/admin/support' },
    { name: 'Technical Analysis', icon: LineChart, path: '/admin/technical-analysis' },
  ]

  // Check if user is in investor mode (uses sessionStorage - tab specific)
  // Admin uses localStorage, Investor uses sessionStorage
  const adminToken = localStorage.getItem('adminToken')
  const investorModeFlag = sessionStorage.getItem('investorMode') === 'true'
  const isInvestorMode = investorModeFlag

  useEffect(() => {
    const token = localStorage.getItem('adminToken')
    const investorMode = sessionStorage.getItem('investorMode')
    
  
    if (!token && !investorMode) {
      navigate('/admin')
    }
  }, [navigate])

  const handleLogout = () => {
    // Redirect based on who was logged in
    const wasInvestor = isInvestorMode
    
    // Clear admin data (localStorage)
    localStorage.removeItem('adminToken')
    localStorage.removeItem('adminUser')
    
    // Clear investor data (sessionStorage - tab specific)
    sessionStorage.removeItem('investorMode')
    sessionStorage.removeItem('investorAccessType')
    sessionStorage.removeItem('investorAccount')
    sessionStorage.removeItem('investorAccountId')
    
    toast.success('Logged out successfully!')
    
    if (wasInvestor) {
      navigate('/investor/login')
    } else {
      navigate('/admin')
    }
  }

  const isActive = (path) => location.pathname === path

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  return (
    <div className={`h-screen min-h-0 flex overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-dark-900' : 'bg-gray-100'}`}>
      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`
          fixed lg:sticky lg:top-0 lg:self-start shrink-0 inset-y-0 left-0 z-50
          h-screen max-h-screen
          ${sidebarExpanded ? 'w-64' : 'w-16'} 
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${isDarkMode ? 'bg-dark-900 border-gray-800' : 'bg-white border-gray-200'} border-r flex flex-col 
          transition-all duration-300 ease-in-out
        `}
      >
        {/* Logo */}
        <div className={`p-4 flex items-center justify-between border-b shrink-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          {sidebarExpanded && (
            <div className="flex items-center gap-2">
              <img src={logoImage} alt="vxness" className="h-12 w-auto object-contain flex-shrink-0" />
            </div>
          )}
          <button 
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
            className={`${!sidebarExpanded ? 'mx-auto' : ''} hidden lg:block p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-dark-700' : 'hover:bg-gray-100'}`}
          >
            <Menu size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
          </button>
          <button 
            onClick={() => setMobileMenuOpen(false)}
            className={`lg:hidden p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-dark-700' : 'hover:bg-gray-100'}`}
          >
            <X size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
          </button>
        </div>

        {/* Menu */}
        <nav className="flex-1 min-h-0 px-2 py-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
          {menuItems.map((item) => (
            <button
              key={item.name}
              onClick={() => {
                navigate(item.path)
                setMobileMenuOpen(false)
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors ${
                isActive(item.path)
                  ? 'bg-accent-green text-black' 
                  : isDarkMode 
                    ? 'text-gray-400 hover:text-white hover:bg-dark-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
              title={!sidebarExpanded ? item.name : ''}
            >
              <item.icon size={18} className="flex-shrink-0" />
              {sidebarExpanded && (
                <span className="text-sm font-medium whitespace-nowrap truncate">{item.name}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Theme Toggle & Logout */}
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
          
          {/* Logout */}
          <button 
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors rounded-lg ${
              isDarkMode ? 'text-gray-400 hover:text-white hover:bg-dark-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
            title={!sidebarExpanded ? 'Log Out' : ''}
          >
            <LogOut size={18} className="flex-shrink-0" />
            {sidebarExpanded && <span className="text-sm font-medium whitespace-nowrap">Log Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <header className={`sticky top-0 z-30 backdrop-blur-sm flex items-center justify-between px-4 sm:px-6 py-4 border-b ${isDarkMode ? 'bg-dark-900/95 border-gray-800' : 'bg-white/95 border-gray-200'}`}>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setMobileMenuOpen(true)}
              className={`lg:hidden p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-dark-700' : 'hover:bg-gray-100'}`}
            >
              <Menu size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
            </button>
            <div>
              <h1 className={`text-lg sm:text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{title || 'Admin Dashboard'}</h1>
              {subtitle && <p className={`text-sm hidden sm:block ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>{subtitle}</p>}
            </div>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs sm:text-sm ${
            isInvestorMode 
              ? 'bg-yellow-500/20 text-yellow-500' 
              : 'bg-red-500/20 text-red-500'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isInvestorMode ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
            <span className="hidden sm:inline">{isInvestorMode ? 'Investor Mode (Read-Only)' : 'Admin Mode'}</span>
          </div>
        </header>

        {/* Page Content */}
        <div className={`p-4 sm:p-6 ${isInvestorMode ? 'investor-read-only' : ''}`}>
          {children}
        </div>
      </main>
      
      {/* Investor Mode Overlay - blocks all clicks */}
      {isInvestorMode && (
        <style>{`
          .investor-read-only button:not([data-allow-investor]),
          .investor-read-only input:not([data-allow-investor]),
          .investor-read-only select:not([data-allow-investor]),
          .investor-read-only textarea:not([data-allow-investor]),
          .investor-read-only [role="button"]:not([data-allow-investor]) {
            pointer-events: none !important;
            opacity: 0.6 !important;
            cursor: not-allowed !important;
          }
          .investor-read-only a:not([data-allow-investor]) {
            pointer-events: none !important;
          }
        `}</style>
      )}
    </div>
  )
}

export default AdminLayout
