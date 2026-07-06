// TradingView free "Advanced Chart" embed widget.
//
// NOTE: This intentionally uses TradingView's free, no-license embed widget
// (s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js) instead
// of the licensed Charting Library. The licensed library required dropping
// non-committable distribution files into frontend/public/charting_library/,
// which were missing in production and left the chart blank.
//
// Trade-off: candles come from TradingView's own data providers (e.g. OANDA /
// BINANCE), so the chart price can differ slightly from the order panel, which
// is fed by Infoway. This is accepted to guarantee the chart always renders.
import { useEffect, useRef, useState } from 'react'

const WIDGET_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'

// Known crypto bases (our feed uses XXXUSD; TradingView free crypto data is on BINANCE as XXXUSDT).
const CRYPTO_BASES = new Set([
  'BTC', 'ETH', 'XRP', 'LTC', 'BCH', 'ADA', 'DOT', 'DOGE', 'SOL', 'BNB',
  'MATIC', 'AVAX', 'LINK', 'TRX', 'UNI', 'ATOM', 'XLM', 'ETC', 'FIL', 'APT',
  'NEAR', 'ARB', 'OP', 'SHIB', 'PEPE', 'SUI',
])

// Symbols that don't follow the simple OANDA:<SYMBOL> pattern.
const SPECIAL_SYMBOLS = {
  USOIL: 'TVC:USOIL',
  UKOIL: 'TVC:UKOIL',
  WTI: 'TVC:USOIL',
  BRENT: 'TVC:UKOIL',
  NGAS: 'TVC:NATURALGAS',
  NATGAS: 'TVC:NATURALGAS',
  COPPER: 'TVC:COPPER',
  US30: 'OANDA:US30USD',
  US100: 'OANDA:NAS100USD',
  NAS100: 'OANDA:NAS100USD',
  US500: 'OANDA:SPX500USD',
  SPX500: 'OANDA:SPX500USD',
  GER40: 'OANDA:DE30EUR',
  DE40: 'OANDA:DE30EUR',
  UK100: 'OANDA:UK100GBP',
  JP225: 'OANDA:JP225USD',
}

// Map our internal symbol (e.g. "XAUUSD", "EURUSD", "BTCUSD") to a TradingView
// exchange-qualified symbol the free widget understands.
function toTradingViewSymbol(rawSymbol) {
  const s = String(rawSymbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!s) return 'OANDA:XAUUSD'
  if (SPECIAL_SYMBOLS[s]) return SPECIAL_SYMBOLS[s]

  // Crypto: BTCUSD / BTCUSDT -> BINANCE:BTCUSDT
  const base = s.replace(/USDT?$/, '')
  if ((s.endsWith('USD') || s.endsWith('USDT')) && CRYPTO_BASES.has(base)) {
    return `BINANCE:${base}USDT`
  }

  // Forex + metals (XAUUSD, XAGUSD, XPTUSD, XPDUSD, EURUSD, ...) live on OANDA.
  return `OANDA:${s}`
}

export default function TradingViewChart({ symbol = 'XAUUSD', interval = '5', theme = 'dark' }) {
  const containerRef = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    setFailed(false)
    // Reset any previous widget (symbol/interval/theme changed).
    container.innerHTML = ''

    const widgetHolder = document.createElement('div')
    widgetHolder.className = 'tradingview-widget-container__widget'
    widgetHolder.style.height = '100%'
    widgetHolder.style.width = '100%'
    container.appendChild(widgetHolder)

    const script = document.createElement('script')
    script.src = WIDGET_SRC
    script.type = 'text/javascript'
    script.async = true
    // If the external widget script is blocked/unreachable, show a fallback.
    script.onerror = () => setFailed(true)
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: toTradingViewSymbol(symbol),
      interval: String(interval),
      timezone: 'Etc/UTC',
      theme,
      style: '1', // candles
      locale: 'en',
      allow_symbol_change: false,
      hide_side_toolbar: false,
      backgroundColor: theme === 'dark' ? '#0d0d0d' : '#ffffff',
      support_host: 'https://www.tradingview.com',
    })
    container.appendChild(script)

    return () => {
      container.innerHTML = ''
    }
  }, [symbol, interval, theme])

  // Absolute-fill the (relative) parent so the widget always gets a concrete
  // pixel height — otherwise autosize can collapse the chart to 0px.
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ width: '100%', height: '100%' }}
      />
      {failed && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme === 'dark' ? '#9ca3af' : '#6b7280',
            fontSize: 14,
            textAlign: 'center',
            padding: 16,
          }}
        >
          Chart could not load. Please check your connection or disable any ad/script blocker, then refresh.
        </div>
      )}
    </div>
  )
}
