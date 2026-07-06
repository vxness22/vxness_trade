import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { InvestorProvider } from './context/InvestorContext'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import MobileTradingApp from './pages/MobileTradingApp'
import Account from './pages/Account'
import WalletPage from './pages/WalletPage'
import OrderBook from './pages/OrderBook'
import TradingPage from './pages/TradingPage'
import CopyTradePage from './pages/CopyTradePage'
import IBPage from './pages/IBPage'
import ProfilePage from './pages/ProfilePage'
import SupportPage from './pages/SupportPage'
import InstructionsPage from './pages/InstructionsPage'
import AdminLogin from './pages/AdminLogin'
import AdminOverview from './pages/AdminOverview'
import AdminUserManagement from './pages/AdminUserManagement'
import AdminAccounts from './pages/AdminAccounts'
import AdminAccountTypes from './pages/AdminAccountTypes'
import AdminTransactions from './pages/AdminTransactions'
import AdminPaymentMethods from './pages/AdminPaymentMethods'
import AdminTradeManagement from './pages/AdminTradeManagement'
import AdminFundManagement from './pages/AdminFundManagement'
import AdminBankSettings from './pages/AdminBankSettings'
import AdminIBManagement from './pages/AdminIBManagement'
import AdminForexCharges from './pages/AdminForexCharges'
import AdminIndianCharges from './pages/AdminIndianCharges'
import AdminCopyTrade from './pages/AdminCopyTrade'
import AdminPropFirm from './pages/AdminPropFirm'
import AdminManagement from './pages/AdminManagement'
import AdminKYC from './pages/AdminKYC'
import AdminSupport from './pages/AdminSupport'
import BuyChallengePage from './pages/BuyChallengePage'
import ChallengeDashboardPage from './pages/ChallengeDashboardPage'
import AdminPropTrading from './pages/AdminPropTrading'
import AdminEarnings from './pages/AdminEarnings'
import ForgotPassword from './pages/ForgotPassword'
import AdminThemeSettings from './pages/AdminThemeSettings'
import BrandedLogin from './pages/BrandedLogin'
import BrandedSignup from './pages/BrandedSignup'
import AdminEmailTemplates from './pages/AdminEmailTemplates'
import AdminBonusManagement from './pages/AdminBonusManagement'
import AdminCreditRequests from './pages/AdminCreditRequests'
import AdminTechnicalAnalysis from './pages/AdminTechnicalAnalysis'
import InvestorLogin from './pages/InvestorLogin'
import InvestorDashboard from './pages/InvestorDashboard'
import AdminInvestorAccess from './pages/AdminInvestorAccess'
import AdminMarginAlerts from './pages/AdminMarginAlerts'

// Website pages
import WebsiteHome from './website/src/pages/Home'
import WebsiteAbout from './website/src/pages/about/About'
import WebsitePropFirm from './website/src/pages/prop-firm/Prop-firm'
import WebsitePartnership from './website/src/pages/partnership/Partnership'
import WebsiteContact from './website/src/pages/contact/Contact'
import WebsiteBlog from './website/src/pages/blog/Blog'
import WebsiteLegal from './website/src/pages/legal/Legal'
import WebsiteForexMarket from './website/src/pages/markets/forex/Forex'
import WebsiteIndicesMarket from './website/src/pages/markets/indices/Indices'
import WebsiteCommoditiesMarket from './website/src/pages/markets/commodities/Commodities'
import WebsiteMetalsMarket from './website/src/pages/markets/metals/Metals'
import WebsiteCfdsMarket from './website/src/pages/markets/cfds/Cfds'
import WebsiteAccountTypes from './website/src/pages/accounts/types/Types'
import WebsiteDepositsWithdrawals from './website/src/pages/accounts/deposits-withdrawals/Deposits-withdrawals'

function App() {
  return (
    <InvestorProvider>
      <Router>
        <Routes>
        {/* Website Routes */}
        <Route path="/" element={<WebsiteHome />} />
        <Route path="/about" element={<WebsiteAbout />} />
        <Route path="/prop-firm" element={<WebsitePropFirm />} />
        <Route path="/partnership" element={<WebsitePartnership />} />
        <Route path="/contact" element={<WebsiteContact />} />
        <Route path="/blog" element={<WebsiteBlog />} />
        <Route path="/legal/*" element={<WebsiteLegal />} />
        <Route path="/markets/forex" element={<WebsiteForexMarket />} />
        <Route path="/markets/indices" element={<WebsiteIndicesMarket />} />
        <Route path="/markets/commodities" element={<WebsiteCommoditiesMarket />} />
        <Route path="/markets/metals" element={<WebsiteMetalsMarket />} />
        <Route path="/markets/cfds" element={<WebsiteCfdsMarket />} />
        <Route path="/accounts/types" element={<WebsiteAccountTypes />} />
        <Route path="/accounts/deposits-withdrawals" element={<WebsiteDepositsWithdrawals />} />
        <Route path="/login" element={<Navigate to="/user/login" replace />} />
        <Route path="/signup" element={<Navigate to="/user/signup" replace />} />
        <Route path="/user/signup" element={<Signup />} />
        <Route path="/user/login" element={<Login />} />
        <Route path="/user/forgot-password" element={<ForgotPassword />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/mobile" element={<MobileTradingApp />} />
        <Route path="/account" element={<Account />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/orders" element={<OrderBook />} />
        <Route path="/trade/:accountId" element={<TradingPage />} />
        <Route path="/copytrade" element={<CopyTradePage />} />
        <Route path="/ib" element={<IBPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/instructions" element={<InstructionsPage />} />
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminOverview />} />
        <Route path="/admin/users" element={<AdminUserManagement />} />
        <Route path="/admin/accounts" element={<AdminAccounts />} />
        <Route path="/admin/account-types" element={<AdminAccountTypes />} />
        <Route path="/admin/transactions" element={<AdminTransactions />} />
        <Route path="/admin/payment-methods" element={<AdminPaymentMethods />} />
        <Route path="/admin/trades" element={<AdminTradeManagement />} />
        <Route path="/admin/funds" element={<AdminFundManagement />} />
        <Route path="/admin/bank-settings" element={<AdminBankSettings />} />
        <Route path="/admin/ib-management" element={<AdminIBManagement />} />
        <Route path="/admin/forex-charges" element={<AdminForexCharges />} />
        <Route path="/admin/indian-charges" element={<AdminIndianCharges />} />
        <Route path="/admin/copy-trade" element={<AdminCopyTrade />} />
        <Route path="/admin/prop-firm" element={<AdminPropFirm />} />
        <Route path="/admin/admin-management" element={<AdminManagement />} />
        <Route path="/admin/kyc" element={<AdminKYC />} />
        <Route path="/admin/support" element={<AdminSupport />} />
        <Route path="/admin/prop-trading" element={<AdminPropTrading />} />
        <Route path="/admin/earnings" element={<AdminEarnings />} />
        <Route path="/admin/theme" element={<AdminThemeSettings />} />
        <Route path="/admin/email-templates" element={<AdminEmailTemplates />} />
        <Route path="/admin/bonus-management" element={<AdminBonusManagement />} />
        <Route path="/admin/credit-requests" element={<AdminCreditRequests />} />
        <Route path="/admin/technical-analysis" element={<AdminTechnicalAnalysis />} />
        <Route path="/admin/investor-access" element={<AdminInvestorAccess />} />
        <Route path="/admin/margin-alerts" element={<AdminMarginAlerts />} />
        <Route path="/buy-challenge" element={<BuyChallengePage />} />
        <Route path="/challenge-dashboard" element={<ChallengeDashboardPage />} />
        <Route path="/investor/login" element={<InvestorLogin />} />
        <Route path="/investor/dashboard/:accountId" element={<InvestorDashboard />} />
        <Route path="/:slug/login" element={<BrandedLogin />} />
        <Route path="/:slug/signup" element={<BrandedSignup />} />
        </Routes>
      </Router>
    </InvestorProvider>
  )
}

export default App
