
import { useState, useEffect } from "react"
import { TrendingUp, TrendingDown } from "lucide-react"
import { formatPrice } from "../../../utils/formatPrice"

const instruments = [
  { name: "EURUSD", bid: 1.15602, ask: 1.15606, change: -0.30, category: "Forex" },
  { name: "US30", bid: 38421.50, ask: 38425.00, change: 0.45, category: "Indices" },
  { name: "XAUUSD", bid: 2345.60, ask: 2345.90, change: 1.12, category: "Metals" },
  { name: "BTCUSD", bid: 67542.00, ask: 67558.00, change: -0.85, category: "Crypto" },
  { name: "GBPUSD", bid: 1.26450, ask: 1.26455, change: 0.22, category: "Forex" },
  { name: "NASDAQ", bid: 17845.25, ask: 17848.00, change: 0.68, category: "Indices" },
]

export function PricingTableSection() {
  const [activeTab, setActiveTab] = useState("All")
  const [prices, setPrices] = useState(instruments)

  // Simulate live price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setPrices(prev => prev.map(instrument => ({
        ...instrument,
        bid: instrument.bid + (Math.random() - 0.5) * 0.001 * instrument.bid,
        ask: instrument.ask + (Math.random() - 0.5) * 0.001 * instrument.ask,
        change: instrument.change + (Math.random() - 0.5) * 0.1
      })))
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  const tabs = ["All", "Forex", "Indices", "Metals", "Crypto"]

  const filteredPrices = activeTab === "All" 
    ? prices 
    : prices.filter(p => p.category === activeTab)

  return (
    <section className="py-20 lg:py-28 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Live Pricing</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4 text-balance">
            Real-Time Institutional Pricing Transparency
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Trade with full price visibility and live market execution.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                activeTab === tab
                  ? "bg-primary text-white"
                  : "bg-white text-muted-foreground hover:bg-muted"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Pricing Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left py-3 px-3 sm:py-4 sm:px-6 text-xs sm:text-sm font-semibold text-muted-foreground">Instrument</th>
                  <th className="text-right py-3 px-3 sm:py-4 sm:px-6 text-xs sm:text-sm font-semibold text-muted-foreground">Bid</th>
                  <th className="text-right py-3 px-3 sm:py-4 sm:px-6 text-xs sm:text-sm font-semibold text-muted-foreground">Ask</th>
                  <th className="text-right py-3 px-3 sm:py-4 sm:px-6 text-xs sm:text-sm font-semibold text-muted-foreground">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredPrices.map((instrument, index) => (
                  <tr key={index} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-3 sm:py-4 sm:px-6">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-muted rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-foreground">
                            {instrument.name.substring(0, 2)}
                          </span>
                        </div>
                        <div>
                          <div className="font-semibold text-foreground text-sm sm:text-base">{instrument.name}</div>
                          <div className="text-xs text-muted-foreground">{instrument.category}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 sm:py-4 sm:px-6 text-right font-mono text-xs sm:text-sm text-foreground">
                      {formatPrice(instrument.bid, instrument.name)}
                    </td>
                    <td className="py-3 px-3 sm:py-4 sm:px-6 text-right font-mono text-xs sm:text-sm text-foreground">
                      {formatPrice(instrument.ask, instrument.name)}
                    </td>
                    <td className="py-3 px-3 sm:py-4 sm:px-6 text-right">
                      <div className={`inline-flex items-center gap-1 px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium ${
                        instrument.change >= 0 
                          ? "bg-green-50 text-green-600" 
                          : "bg-red-50 text-red-600"
                      }`}>
                        {instrument.change >= 0 ? (
                          <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                        ) : (
                          <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4" />
                        )}
                        {instrument.change >= 0 ? "+" : ""}{instrument.change.toFixed(2)}%
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Table Footer */}
          <div className="bg-muted/30 px-6 py-4 border-t border-border">
            <p className="text-sm text-muted-foreground text-center">
              Ultra-fast execution. Zero dealing desk intervention. Transparent spreads.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
