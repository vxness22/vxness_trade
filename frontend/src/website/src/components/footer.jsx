import { Link } from 'react-router-dom'
import { Facebook, Twitter, Linkedin, Instagram, Youtube } from "lucide-react"

const footerLinks = {
  accounts: {
    title: "Accounts",
    links: [
      { label: "Deposit & Withdrawal", href: "/accounts/deposits-withdrawals" },
      { label: "Account Types", href: "/accounts/types" },
    ],
  },
  markets: {
    title: "Markets",
    links: [
      { label: "Forex", href: "/markets/forex" },
      { label: "Commodities", href: "/markets/commodities" },
      { label: "Metals", href: "/markets/metals" },
      { label: "Indices", href: "/markets/indices" },
      { label: "CFDs", href: "/markets/cfds" },
    ],
  },
  tools: {
    title: "Tools",
    links: [
      { label: "Trading Platform", href: "/tools/trading-platform" },
      { label: "Economic Calendar", href: "/tools/economic-calendar" },
      { label: "Heatmap Analysis", href: "/tools/heatmap" },
      { label: "Calculators", href: "/tools/calculators" },
    ],
  },
  partnership: {
    title: "Partnership",
    links: [
      { label: "Affiliate Program", href: "/partnership" },
    ],
  },
  company: {
    title: "Company",
    links: [
      { label: "About Us", href: "/about" },
      { label: "Awards", href: "/about#awards" },
      { label: "Regulation", href: "/about#regulation" },
      { label: "Blog", href: "/blog" },
      { label: "Legal Documents", href: "/legal" },
      { label: "Contact Us", href: "/contact" },
    ],
  },
}

const legalLinks = [
  { label: "Privacy Policy", href: "/legal/privacy-policy" },
  { label: "Terms and Conditions", href: "/legal/terms-and-conditions" },
  { label: "Risk Disclosure", href: "/legal/risk-disclosure" },
  { label: "Conflicts of Interest Disclosure", href: "/legal/conflicts-of-interest" },
  { label: "Deposit & Withdrawal Policy", href: "/legal/deposit-withdrawal-policy" },
  { label: "Relationship Disclosure", href: "/legal/relationship-disclosure" },
  { label: "Restricted Countries", href: "/legal/restricted-countries" },
  { label: "Terms of Use", href: "/legal/terms-of-use" },
]

export function Footer() {
  return (
    <footer className="bg-foreground text-white">
      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
          {/* Logo Column */}
          <div className="sm:col-span-2 md:col-span-3 lg:col-span-1">
            <Link to="/" className="flex items-center mb-6">
              <img src="/images/vxness-logo.png"
                alt="VXNESS"
                width={140}
                height={36}
                className="h-8 w-auto brightness-0 invert" />
            </Link>
            <p className="text-sm text-white/60 mb-6">
              Multi-Asset Trading Platform
            </p>
            {/* Social Links */}
            <div className="flex gap-3">
              {[Facebook, Twitter, Linkedin, Instagram, Youtube].map((Icon, index) => (
                <Link
                  key={index}
                  to="#"
                  className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-primary transition-colors"
                >
                  <Icon className="w-5 h-5" />
                </Link>
              ))}
            </div>
          </div>

          {/* Footer Links */}
          {Object.entries(footerLinks).map(([key, section]) => (
            <div key={key}>
              <h4 className="font-semibold mb-4">{section.title}</h4>
              <ul className="space-y-2">
                {section.links.map((link, index) => (
                  <li key={index}>
                    <Link to={link.href} className="text-sm text-white/60 hover:text-primary transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Warning */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white/5 rounded-xl p-6">
            <h5 className="font-semibold text-sm mb-2 text-yellow-400">Risk Warning</h5>
            <p className="text-xs text-white/60 leading-relaxed">
              CFDs are complex instruments and come with a high risk of losing money rapidly due to leverage. Between 80% of retail investor accounts lose money when trading CFDs with this provider. You should consider whether you understand how CFDs work and whether you can afford to take the high risk of losing your money.
            </p>
            <p className="text-xs text-white/60 leading-relaxed mt-4">
              <strong>Disclaimer:</strong> The content on this website is for informational purposes only and does not constitute financial advice. Trading financial instruments involves significant risk. Seek independent financial advice before making investment decisions.
            </p>
          </div>
        </div>
      </div>

      {/* Legal Links */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap gap-4 justify-center mb-6">
            {legalLinks.map((link, index) => (
              <Link key={index} to={link.href} className="text-xs text-white/40 hover:text-primary transition-colors">
                {link.label}
              </Link>
            ))}
          </div>
          <p className="text-xs text-white/40 text-center">
            © {new Date().getFullYear()} VXNESS. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
