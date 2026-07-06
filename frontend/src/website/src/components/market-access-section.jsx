import { TrendingUp, Gem, BarChart3, Fuel } from "lucide-react"

const markets = [
  {
    icon: TrendingUp,
    title: "Forex",
    description: "Major, Minor & Exotic currency pairs with competitive spreads and deep liquidity.",
    color: "bg-blue-50 text-blue-600",
    image: "/images/forex-1.jpg",
  },
  {
    icon: Gem,
    title: "Metals",
    description: "Gold (XAUUSD), Silver (XAGUSD) and other precious metals with institutional pricing.",
    color: "bg-yellow-50 text-yellow-600",
    image: "/images/metals-1.jpg",
  },
  {
    icon: BarChart3,
    title: "Indices",
    description: "Global indices including US30, NASDAQ, DAX, FTSE and more.",
    color: "bg-green-50 text-green-600",
    image: "/images/indices-1.jpg",
  },
  {
    icon: Fuel,
    title: "Commodities",
    description: "Energy, agriculture and raw materials with flexible contract specifications.",
    color: "bg-orange-50 text-orange-600",
    image: "/images/commodities-1.jpg",
  },
]

export function MarketAccessSection() {
  return (
    <section className="py-20 lg:py-28 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Markets</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4 text-balance">
            Multi-Asset Market Coverage
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Access diversified global markets through a single integrated account.
          </p>
        </div>

        {/* Market Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {markets.map((market, index) => (
            <div
              key={index}
              className="group bg-white border border-border rounded-2xl overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all duration-300 hover:-translate-y-1"
            >
              {/* Image */}
              <div className="relative w-full aspect-[4/3] overflow-hidden bg-muted">
                <img src={market.image}
                  alt={market.title}
                  
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              </div>

              {/* Card Content */}
              <div className="p-6">
                <div className={`w-14 h-14 rounded-xl ${market.color} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}>
                  <market.icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">{market.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{market.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
