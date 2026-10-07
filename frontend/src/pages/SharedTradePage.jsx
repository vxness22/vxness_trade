import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_URL } from '../config/api'
import logo from '../assets/logo.png'

// vxness.in/s/<code> — a trade a trader chose to share from the desktop
// terminal's Share dialog. Public: the API returns only that trade's figures
// and the trader's own caption, nothing that identifies them.

const fmtPrice = (v, digits) =>
  Number.isFinite(Number(v)) ? Number(v).toFixed(digits ?? 5) : '—'

const signed = (v, suffix = '') => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}${suffix}`
}

function headline(t) {
  if (t.display_mode === 'roi' && t.roi_pct != null) return signed(t.roi_pct, '%')
  if (t.display_mode === 'ticks' && t.ticks != null) {
    const n = Number(t.ticks)
    return `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(1)} ticks`
  }
  const n = Number(t.profit)
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`
}

export default function SharedTradePage() {
  const { code } = useParams()
  const [trade, setTrade] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`${API_URL}/v1/share/${encodeURIComponent(code)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.detail || 'This link does not exist')
        return body
      })
      .then((t) => { if (alive) setTrade(t) })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [code])

  const up = trade && Number(trade.profit) >= 0
  const isBuy = trade && String(trade.side).toUpperCase() === 'BUY'

  return (
    <div className="min-h-screen bg-[#0b0f14] text-white flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center mb-6">
          <img src={logo} alt="Vxness" className="h-12 object-contain" />
        </div>

        {error && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <p className="text-lg font-semibold">{error}</p>
            <p className="mt-2 text-sm text-white/60">The trade may have been removed, or the link mistyped.</p>
          </div>
        )}

        {!error && !trade && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
            Loading trade…
          </div>
        )}

        {trade && (
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#10402a] to-[#0b0f14] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold tracking-wide">{trade.symbol}</p>
                <p className="mt-1 text-sm text-white/70">
                  <span className={isBuy ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                    {isBuy ? 'BUY' : 'SELL'}
                  </span>
                  {' · '}{Number(trade.lots).toFixed(2)} lots
                </p>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wider text-white/80">
                {trade.status === 'open' ? 'Open' : 'Closed'}
              </span>
            </div>

            <p className={`mt-6 text-center text-4xl font-extrabold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
              {headline(trade)}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-black/30 p-3">
                <p className="text-white/50">Open price</p>
                <p className="mt-1 font-mono">{fmtPrice(trade.open_price, trade.digits)}</p>
              </div>
              <div className="rounded-xl bg-black/30 p-3">
                <p className="text-white/50">{trade.status === 'open' ? 'Current price' : 'Close price'}</p>
                <p className="mt-1 font-mono">{fmtPrice(trade.current_price, trade.digits)}</p>
              </div>
            </div>

            {trade.description && (
              <p className="mt-5 whitespace-pre-wrap text-sm text-white/85">{trade.description}</p>
            )}
            {trade.link_description && (
              <p className="mt-3 whitespace-pre-wrap break-words text-xs text-white/60">{trade.link_description}</p>
            )}
          </div>
        )}

        <div className="mt-6 text-center">
          <Link to="/" className="text-sm text-emerald-400 hover:text-emerald-300">
            Trade with Vxness →
          </Link>
        </div>
      </div>
    </div>
  )
}
