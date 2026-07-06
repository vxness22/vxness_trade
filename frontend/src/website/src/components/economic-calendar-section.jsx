
import { useState } from "react"
import { Calendar, Clock, TrendingUp, TrendingDown, Minus, ChevronDown } from "lucide-react"

const impactStyles = {
  High:   { color: "text-red-600",    dot: "bg-red-500",    badge: "bg-red-50 text-red-600 border-red-200" },
  Medium: { color: "text-yellow-600", dot: "bg-yellow-500", badge: "bg-yellow-50 text-yellow-600 border-yellow-200" },
  Low:    { color: "text-blue-500",   dot: "bg-blue-400",   badge: "bg-blue-50 text-blue-600 border-blue-200" },
}

const currencyFlags = {
  USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵", CAD: "🇨🇦", AUD: "🇦🇺", CHF: "🇨🇭", NZD: "🇳🇿",
}

const impactConfig = {
  High:   { color: "text-red-600",    dot: "bg-red-500",    badge: "bg-red-50 text-red-600 border-red-200" },
  Medium: { color: "text-yellow-600", dot: "bg-yellow-500", badge: "bg-yellow-50 text-yellow-600 border-yellow-200" },
  Low:    { color: "text-blue-500",   dot: "bg-blue-400",   badge: "bg-blue-50 text-blue-600 border-blue-200" },
}

const events = [
  { time: "08:30", currency: "USD", event: "Non-Farm Payrolls", impact: "High", forecast: "180K", previous: "175K", actual: "195K" },
  { time: "10:00", currency: "EUR", event: "ECB Interest Rate Decision", impact: "High", forecast: "4.50%", previous: "4.50%", actual: null },
  { time: "12:00", currency: "GBP", event: "BoE Monetary Policy Report", impact: "High", forecast: "-", previous: "-", actual: null },
  { time: "14:30", currency: "USD", event: "Unemployment Rate", impact: "Medium", forecast: "3.8%", previous: "3.7%", actual: "3.9%" },
  { time: "15:00", currency: "CAD", event: "Ivey PMI", impact: "Medium", forecast: "55.2", previous: "54.8", actual: null },
  { time: "16:00", currency: "USD", event: "ISM Services PMI", impact: "Medium", forecast: "52.5", previous: "51.8", actual: null },
  { time: "18:00", currency: "JPY", event: "BoJ Policy Rate", impact: "High", forecast: "-0.10%", previous: "-0.10%", actual: null },
  { time: "20:00", currency: "AUD", event: "RBA Rate Statement", impact: "Low", forecast: "-", previous: "-", actual: null },
]

function ActualBadge({ actual, forecast }) {
  if (!actual) {
    return <span className="text-muted-foreground text-sm">Pending</span>
  }
  const actualNum = parseFloat(actual)
  const forecastNum = parseFloat(forecast)
  const isBetter = !isNaN(actualNum) && !isNaN(forecastNum) && actualNum > forecastNum
  const isWorse  = !isNaN(actualNum) && !isNaN(forecastNum) && actualNum < forecastNum

  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-sm ${isBetter ? "text-green-600" : isWorse ? "text-red-600" : "text-foreground"}`}>
      {isBetter ? <TrendingUp className="w-3.5 h-3.5" /> : isWorse ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
      {actual}
    </span>
  )
}

export function EconomicCalendarSection() {
  const [filter, setFilter] = useState("All")
  const [expanded, setExpanded] = useState(null)

  const filters = ["All", "High", "Medium", "Low"]

  const filtered = filter === "All" ? events : events.filter(e => e.impact === filter)

  const now = new Date()
  const timeLabel = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })

  return (
    <section className="py-20 lg:py-28 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Economic Calendar</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4 text-balance">
            Live Market-Moving Events
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Stay ahead of major economic releases and central bank decisions that drive volatility.
          </p>
        </div>

        {/* Date + Live badge */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" />
            <span>{timeLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-xs font-semibold text-green-600 uppercase tracking-wider">Live</span>
          </div>
        </div>

        {/* Impact Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all border ${
                filter === f
                  ? f === "High"   ? "bg-red-500 text-white border-red-500"
                  : f === "Medium" ? "bg-yellow-500 text-white border-yellow-500"
                  : f === "Low"    ? "bg-blue-500 text-white border-blue-500"
                  :                  "bg-primary text-white border-primary"
                  : "bg-white text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {f !== "All" && (
                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                  f === "High" ? "bg-red-300" : f === "Medium" ? "bg-yellow-300" : "bg-blue-300"
                } ${filter === f ? "opacity-100" : ""}`} />
              )}
              {f}
            </button>
          ))}
        </div>

        {/* Calendar Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-border overflow-hidden">
          {/* Desktop Header */}
          <div className="hidden md:grid grid-cols-[80px_90px_1fr_110px_100px_100px_110px] gap-4 px-6 py-3 bg-muted/50 border-b border-border">
            {["Time", "Currency", "Event", "Impact", "Forecast", "Previous", "Actual"].map(h => (
              <span key={h} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</span>
            ))}
          </div>

          <div className="divide-y divide-border">
            {filtered.map((event, i) => (
              <div key={i}>
                {/* Desktop Row */}
                <div className="hidden md:grid grid-cols-[80px_90px_1fr_110px_100px_100px_110px] gap-4 items-center px-6 py-4 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-1.5 text-sm font-mono text-foreground">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    {event.time}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg leading-none">{currencyFlags[event.currency] ?? "🌐"}</span>
                    <span className="text-sm font-semibold text-foreground">{event.currency}</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">{event.event}</span>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${impactConfig[event.impact].badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${impactConfig[event.impact].dot}`} />
                      {event.impact}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground font-mono">{event.forecast}</span>
                  <span className="text-sm text-muted-foreground font-mono">{event.previous}</span>
                  <ActualBadge actual={event.actual} forecast={event.forecast} />
                </div>

                {/* Mobile Row */}
                <div className="md:hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-muted/20 transition-colors"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-1 h-10 rounded-full ${impactConfig[event.impact].dot}`} />
                      <div>
                        <div className="text-sm font-semibold text-foreground">{event.event}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground font-mono">{event.time}</span>
                          <span className="text-xs font-semibold text-foreground">{event.currency}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ActualBadge actual={event.actual} forecast={event.forecast} />
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded === i ? "rotate-180" : ""}`} />
                    </div>
                  </button>
                  {expanded === i && (
                    <div className="px-4 pb-4 grid grid-cols-3 gap-3 text-center bg-muted/10">
                      {[
                        { label: "Impact",   value: <span className={`text-xs font-semibold ${impactConfig[event.impact].color}`}>{event.impact}</span> },
                        { label: "Forecast", value: <span className="text-sm font-mono text-foreground">{event.forecast}</span> },
                        { label: "Previous", value: <span className="text-sm font-mono text-foreground">{event.previous}</span> },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white rounded-xl p-3 border border-border">
                          <div className="text-xs text-muted-foreground mb-1">{label}</div>
                          {value}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="bg-muted/30 px-6 py-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              All times displayed in <span className="font-semibold text-foreground">UTC</span>. Data updates every 60 seconds.
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {["High", "Medium", "Low"].map(lvl => (
                <span key={lvl} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${impactConfig[lvl].dot}`} />
                  {lvl} Impact
                </span>
              ))}
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}
