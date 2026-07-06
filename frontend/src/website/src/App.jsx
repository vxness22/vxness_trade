import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import About from './pages/about/About'
import PropFirm from './pages/prop-firm/Prop-firm'
import Partnership from './pages/partnership/Partnership'
import Contact from './pages/contact/Contact'
import Blog from './pages/blog/Blog'
import Legal from './pages/legal/Legal'
import ForexMarket from './pages/markets/forex/Forex'
import IndicesMarket from './pages/markets/indices/Indices'
import CommoditiesMarket from './pages/markets/commodities/Commodities'
import MetalsMarket from './pages/markets/metals/Metals'
import CfdsMarket from './pages/markets/cfds/Cfds'
import AccountTypes from './pages/accounts/types/Types'
import DepositsWithdrawals from './pages/accounts/deposits-withdrawals/Deposits-withdrawals'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/prop-firm" element={<PropFirm />} />
      <Route path="/partnership" element={<Partnership />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/legal/*" element={<Legal />} />
      <Route path="/markets/forex" element={<ForexMarket />} />
      <Route path="/markets/indices" element={<IndicesMarket />} />
      <Route path="/markets/commodities" element={<CommoditiesMarket />} />
      <Route path="/markets/metals" element={<MetalsMarket />} />
      <Route path="/markets/cfds" element={<CfdsMarket />} />
      <Route path="/accounts/types" element={<AccountTypes />} />
      <Route path="/accounts/deposits-withdrawals" element={<DepositsWithdrawals />} />
    </Routes>
  )
}

export default App
