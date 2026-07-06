import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"

const API_URL = `${String(import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "")}/api`

const TYPE_LABEL = { 0: "Instant Fund", 1: "One Step", 2: "Two Step" }
const TYPE_SUB = { 0: "No Evaluation", 1: "Single Evaluation", 2: "Dual Evaluation" }
const sizeLabel = (n) => `$${n >= 1000 ? `${n / 1000}K` : n}`

export function PricingSelector() {
  const navigate = useNavigate()
  const [challenges, setChallenges] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState(null)
  const [size, setSize] = useState(null)

  useEffect(() => {
    fetch(`${API_URL}/prop/challenges`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.challenges)) setChallenges(d.challenges)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const types = useMemo(
    () => [...new Set(challenges.map((c) => c.stepsCount))].sort((a, b) => a - b),
    [challenges]
  )
  const sizes = useMemo(
    () =>
      type === null
        ? []
        : [...new Set(challenges.filter((c) => c.stepsCount === type).map((c) => c.fundSize))].sort(
            (a, b) => a - b
          ),
    [challenges, type]
  )

  // Default selections once data arrives
  useEffect(() => {
    if (type === null && types.length) setType(types[0])
  }, [types, type])
  useEffect(() => {
    if (sizes.length && !sizes.includes(size)) setSize(sizes[0])
  }, [sizes, size])

  const plan = useMemo(
    () => challenges.find((c) => c.stepsCount === type && c.fundSize === size) || null,
    [challenges, type, size]
  )

  const handleBuy = () => {
    if (!plan) return
    const user = JSON.parse(localStorage.getItem("user") || "{}")
    navigate(user._id ? `/buy-challenge?challenge=${plan._id}` : "/user/login")
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!challenges.length) {
    return (
      <p className="text-center text-muted-foreground py-16">
        Challenges are not available right now. Please check back soon.
      </p>
    )
  }

  const r = plan?.rules || {}
  const trailing = r.drawdownType === "TRAILING"

  return (
    <div className="max-w-3xl mx-auto">
      {/* Type tabs */}
      <div className="flex flex-wrap justify-center gap-2 mb-4">
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-colors ${
              type === t
                ? "bg-primary text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {TYPE_LABEL[t] || `${t}-Step`}
          </button>
        ))}
      </div>

      {/* Size chips */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {sizes.map((s) => (
          <button
            key={s}
            onClick={() => setSize(s)}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
              size === s
                ? "bg-primary text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {sizeLabel(s)}
          </button>
        ))}
      </div>

      {/* Plan card */}
      {plan && (
        <div className="bg-white border border-border rounded-2xl shadow-xl overflow-hidden">
          <div className="flex items-start justify-between p-6 border-b border-border">
            <div>
              <p className="text-3xl font-bold text-foreground">{sizeLabel(plan.fundSize)}</p>
              <p className="text-muted-foreground text-sm mt-1">Account Size</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-primary">{TYPE_LABEL[plan.stepsCount]}</p>
              <p className="text-muted-foreground text-sm">{TYPE_SUB[plan.stepsCount]}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-4 p-6">
            <Metric label="Profit Split" value={`${plan.fundedSettings?.profitSplitPercent ?? 80}%`} />
            <Metric label="Leverage" value={`Up to 1:${r.maxLeverage ?? 100}`} />
            {plan.stepsCount === 0 ? (
              <Metric label="Evaluation" value="None" />
            ) : (
              <Metric
                label={plan.stepsCount === 2 ? "Profit Target (P1)" : "Profit Target"}
                value={`${r.profitTargetPhase1Percent ?? 10}%`}
              />
            )}
            {plan.stepsCount === 2 && (
              <Metric label="Profit Target (P2)" value={`${r.profitTargetPhase2Percent ?? 8}%`} />
            )}
            <Metric
              label="Max Daily Loss"
              value={`${r.maxDailyDrawdownPercent ?? 5}%${trailing ? " Trailing" : ""}`}
            />
            <Metric
              label="Max Drawdown"
              value={`${r.maxOverallDrawdownPercent ?? 10}%${trailing ? " Trailing" : ""}`}
            />
          </div>

          <div className="px-6 pb-2">
            <p className="text-center text-xs text-muted-foreground mb-2">Platform</p>
            <div className="flex justify-center">
              <span className="px-4 py-1.5 rounded-full bg-muted text-foreground text-sm font-medium">MT5</span>
            </div>
          </div>

          {/* Fee + CTA */}
          <div className="flex items-center justify-between gap-4 m-4 mt-6 rounded-xl bg-primary p-5">
            <div>
              <p className="text-white/80 text-xs">Challenge Fee</p>
              <p className="text-3xl font-bold text-white">${plan.challengeFee}</p>
            </div>
            <Button
              onClick={handleBuy}
              className="bg-white text-primary hover:bg-white/90 font-semibold px-6 py-5"
            >
              <Check className="w-4 h-4 mr-2" />
              Buy the Challenge
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
      <p className="text-foreground font-semibold">{value}</p>
    </div>
  )
}
