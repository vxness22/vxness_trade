// Full TradingView Charting Library chart — the pro UI fed by OUR backend data
// so the candles match the running P&L (unlike the free Advanced Chart embed,
// which streams TradingView's public OANDA/BINANCE feed).
//
// Ported from SwisDex's ChartingLibraryChart.tsx. Wires the licensed library in
// public/charting_library/ to vxnessDatafeed (history = /api/charts/bars from
// Infoway klines; live = /ws/bars). Also draws a BUY/SELL entry line + SL/TP for
// each open position on the current symbol.
//
// Drop-in replacement for <TradingViewChart symbol interval theme /> — plus an
// optional `positions` prop (open trades) it renders as chart lines.
import { useEffect, useRef, useState } from 'react'
import { vxnessDatafeed } from '../services/chartingDatafeed'

// The licensed library attaches `TradingView` to window once the script runs.
function tvCtor() {
  if (typeof window === 'undefined') return undefined
  return window.TradingView && window.TradingView.widget
}

let _libPromise = null
function loadChartingLibrary() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (tvCtor()) return Promise.resolve()
  if (_libPromise) return _libPromise
  _libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/charting_library/charting_library.standalone.js'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { _libPromise = null; reject(new Error('charting_library failed to load')) }
    document.head.appendChild(s)
  })
  return _libPromise
}

const CHART_SAVE_KEY = 'vxness_chart_layout_v1'

// Blue/red industry-standard line colours (BUY blue, SELL red).
const CHART_BUY_COLOR = '#3b82f6'
const CHART_SELL_COLOR = '#ef4444'
const SL_COLOR = '#f59e0b'
const TP_COLOR = '#14b8a6'
const PROFIT_COLOR = '#3b82f6'
const LOSS_COLOR = '#ef4444'
const BREAKEVEN_COLOR = '#9ca3af'

// The candle is drawn at the BID (datafeed halfSpreadOf), so the library's own
// last-price line IS the LTP (bid). Enable + thin it.
const LTP_LINE_OVERRIDES = {
  'mainSeriesProperties.showPriceLine': true,
  'mainSeriesProperties.priceLineWidth': 1,
}

// Normalise a vxness trade object into the fields this chart needs.
function normalizePosition(p) {
  const id = String(p.id || p._id || p.ticket || p.orderId || '')
  const side = String(p.side || p.type || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
  const openPrice = Number(p.openPrice ?? p.entryPrice ?? p.price ?? 0)
  const lots = Number(p.quantity ?? p.lots ?? p.volume ?? 0)
  const sl = Number(p.sl ?? p.stopLoss ?? 0)
  const tp = Number(p.tp ?? p.takeProfit ?? 0)
  const profit = Number(p.profit ?? p.pnl ?? 0)
  return { id, symbol: String(p.symbol || '').toUpperCase(), side, openPrice, lots, sl, tp, profit }
}

export default function ChartingLibraryChart({ symbol = 'XAUUSD', interval = '5', theme = 'dark', positions = [] }) {
  const containerRef = useRef(null)
  const widgetRef = useRef(null)
  const linesRef = useRef(new Map()) // key -> { id, price, creating }
  const appliedSymbolRef = useRef('')
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  const symU = String(symbol || 'XAUUSD').toUpperCase()

  // Swallow the library's benign "Value is null" context-menu rejection so it
  // doesn't surface as an uncaught console error.
  useEffect(() => {
    const onRej = (e) => {
      const reason = e.reason
      const msg = typeof reason === 'string' ? reason : reason && reason.message
      const stack = (reason && reason.stack) || ''
      if (msg === 'Value is null' && stack.includes('charting_library')) e.preventDefault()
    }
    window.addEventListener('unhandledrejection', onRej)
    return () => window.removeEventListener('unhandledrejection', onRej)
  }, [])

  // Create the widget once (and recreate ONLY on theme change). Symbol changes
  // are applied in place by the effect below via setSymbol().
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setFailed(false)
    linesRef.current.clear()

    loadChartingLibrary().then(() => {
      const Ctor = tvCtor()
      if (cancelled || !containerRef.current || !Ctor) return
      try { widgetRef.current && widgetRef.current.remove && widgetRef.current.remove() } catch { /* noop */ }

      let savedData
      try {
        const s = localStorage.getItem(CHART_SAVE_KEY)
        if (s) savedData = JSON.parse(s)
      } catch { /* start fresh */ }

      const themeOverrides = theme === 'light'
        ? {
            'paneProperties.background': '#ffffff',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': '#ececec',
            'paneProperties.horzGridProperties.color': '#ececec',
            'scalesProperties.textColor': '#131722',
            'scalesProperties.lineColor': '#e0e3eb',
          }
        : {
            'paneProperties.background': '#0c0e12',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': '#1c1f26',
            'paneProperties.horzGridProperties.color': '#1c1f26',
            'scalesProperties.textColor': '#b2b5be',
            'scalesProperties.lineColor': '#2a2e39',
          }

      const w = new Ctor({
        symbol: symU,
        interval: String(interval),
        container: containerRef.current,
        datafeed: vxnessDatafeed,
        library_path: '/charting_library/',
        locale: 'en',
        theme: theme === 'light' ? 'Light' : 'Dark',
        autosize: true,
        timezone: 'Etc/UTC',
        auto_save_delay: 2,
        ...(savedData ? { saved_data: savedData } : {}),
        disabled_features: ['header_symbol_search'],
        enabled_features: [],
        favorites: {
          intervals: ['1', '3', '5', '10', '15', '30', '45', '60', '120', '180', '240', '1D', '1W', '1M'],
        },
        overrides: {
          'symbolWatermarkProperties.transparency': 84,
          'symbolWatermarkProperties.color': theme === 'light'
            ? 'rgba(40,40,40,0.10)' : 'rgba(200,200,200,0.10)',
          ...themeOverrides,
          ...LTP_LINE_OVERRIDES,
        },
      })
      widgetRef.current = w
      appliedSymbolRef.current = symU
      try {
        w.onChartReady && w.onChartReady(() => {
          if (cancelled) return
          setReady(true)
          try { w.applyOverrides && w.applyOverrides(themeOverrides) } catch { /* noop */ }
          try { w.applyOverrides && w.applyOverrides(LTP_LINE_OVERRIDES) } catch { /* noop */ }
          try {
            w.subscribe && w.subscribe('onAutoSaveNeeded', () => {
              try {
                w.save && w.save((state) => {
                  try { localStorage.setItem(CHART_SAVE_KEY, JSON.stringify(state)) } catch { /* quota */ }
                })
              } catch { /* noop */ }
            })
          } catch { /* noop */ }
        })
      } catch { /* noop */ }
    }).catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      setReady(false)
      try { widgetRef.current && widgetRef.current.remove && widgetRef.current.remove() } catch { /* noop */ }
      widgetRef.current = null
      appliedSymbolRef.current = ''
      linesRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  // Change the symbol IN PLACE when the prop changes — keeps the chart in
  // lock-step with the order ticket instead of rebuilding the widget.
  useEffect(() => {
    if (!ready) return
    const w = widgetRef.current
    if (!w || !w.activeChart || appliedSymbolRef.current === symU) return
    try {
      const chart = w.activeChart()
      for (const [, entry] of linesRef.current) {
        try { if (entry && entry.id != null) chart.removeEntity(entry.id) } catch { /* noop */ }
      }
      linesRef.current.clear()
      chart.setSymbol && chart.setSymbol(symU, () => { /* resolved */ })
      appliedSymbolRef.current = symU
    } catch { /* noop */ }
  }, [symU, ready])

  // Reconcile position entry / SL / TP lines whenever positions change.
  useEffect(() => {
    const w = widgetRef.current
    if (!ready || !w || !w.activeChart) return
    let chart
    try { chart = w.activeChart() } catch { return }
    if (!chart || !chart.createShape) return

    const myPos = (positions || [])
      .map(normalizePosition)
      .filter((p) => p.symbol === symU && p.openPrice > 0)

    // Precision for labels.
    const digitsFor = (n) => {
      const s = String(n)
      const dot = s.indexOf('.')
      return dot === -1 ? 2 : Math.min(6, s.length - dot - 1)
    }

    const pnlColor = (pnl) => (Math.abs(pnl) < 0.10 ? BREAKEVEN_COLOR : pnl > 0 ? PROFIT_COLOR : LOSS_COLOR)

    const desired = []
    for (const p of myPos) {
      const dg = digitsFor(p.openPrice)
      const sideColor = p.side === 'BUY' ? CHART_BUY_COLOR : CHART_SELL_COLOR
      const pnlStr = `${p.profit >= 0 ? '+' : '-'}$${Math.abs(p.profit).toFixed(2)}`
      desired.push({
        key: p.id,
        price: p.openPrice,
        color: sideColor,
        textColor: pnlColor(p.profit),
        text: `${p.side} ${p.lots}  ${pnlStr}`,
        dashed: false,
        pnl: p.profit,
      })
      if (p.sl > 0) desired.push({ key: `${p.id}-sl`, price: p.sl, color: SL_COLOR, textColor: SL_COLOR, text: `SL ${p.sl.toFixed(dg)}`, dashed: true })
      if (p.tp > 0) desired.push({ key: `${p.id}-tp`, price: p.tp, color: TP_COLOR, textColor: TP_COLOR, text: `TP ${p.tp.toFixed(dg)}`, dashed: true })
    }

    const shapeOpts = (text, lineColor, textColor, dashed) => ({
      shape: 'horizontal_line',
      text,
      lock: true, disableSelection: true, disableSave: true, disableUndo: true,
      overrides: {
        linecolor: lineColor, linestyle: dashed ? 2 : 0, linewidth: dashed ? 1 : 2,
        showLabel: true, textcolor: textColor, fontsize: 11, bold: true,
        horzLabelsAlign: 'right', vertLabelsAlign: 'middle',
      },
    })

    const t = Math.floor(Date.now() / 1000)
    const wanted = new Set(desired.map((d) => d.key))

    for (const d of desired) {
      const existing = linesRef.current.get(d.key)
      if (!existing) {
        const entry = { id: null, price: d.price, creating: true, text: d.text, color: d.color, textColor: d.textColor }
        linesRef.current.set(d.key, entry)
        chart.createShape({ time: t, price: d.price }, shapeOpts(d.text, d.color, d.textColor, d.dashed))
          .then((id) => {
            if (linesRef.current.get(d.key) === entry) { entry.id = id; entry.creating = false }
            else { try { chart.removeEntity(id) } catch { /* noop */ } }
          })
          .catch(() => { if (linesRef.current.get(d.key) === entry) linesRef.current.delete(d.key) })
      } else if (existing.id != null) {
        if (existing.price !== d.price) {
          try { chart.getShapeById(existing.id).setPoints([{ time: t, price: d.price }]) } catch { /* noop */ }
          existing.price = d.price
        }
        if (d.text !== existing.text || d.color !== existing.color || d.textColor !== existing.textColor) {
          try {
            chart.getShapeById(existing.id).setProperties({ text: d.text, linecolor: d.color, textcolor: d.textColor })
          } catch { /* noop */ }
          existing.text = d.text
          existing.color = d.color
          existing.textColor = d.textColor
        }
      }
    }

    for (const [key, entry] of linesRef.current) {
      if (!wanted.has(key)) {
        if (entry && entry.id != null) { try { chart.removeEntity(entry.id) } catch { /* noop */ } }
        linesRef.current.delete(key)
      }
    }
  }, [positions, symU, ready])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {failed && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: theme === 'dark' ? '#9ca3af' : '#6b7280', fontSize: 14, textAlign: 'center', padding: 16,
          }}
        >
          Chart could not load. The charting library assets may be missing from
          /charting_library/. Please refresh, or contact support.
        </div>
      )}
    </div>
  )
}
