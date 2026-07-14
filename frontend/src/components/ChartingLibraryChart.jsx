// Full TradingView Charting Library chart — pro UI fed by OUR backend data so the
// candles match the running P&L. Ported/adapted from SwisDex's ChartingLibraryChart.
//
// - History: /api/charts/bars (Infoway batch_kline)   - Live candles: /ws/bars
// - Draws a BUY/SELL entry line + SL/TP lines per open position on the symbol.
// - On-chart SL/TP: [SL] [TP] drag buttons on the entry line — press & drag up/down
//   to set the price (a dashed preview follows the cursor), release → confirm → saves
//   via PUT /api/trade/modify. A plain click opens a type-a-price dialog. [✕] closes
//   the position at market (POST /api/trade/close).
//
// Props: symbol, interval, theme ('dark'|'light'), positions (open trades), onRefresh.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { API_URL } from '../config/api'
import priceStreamService from '../services/priceStream'
import { vxnessDatafeed, setQuoteAdjuster } from '../services/chartingDatafeed'
import logoImage from '../assets/logo.png'

function tvCtor() {
  if (typeof window === 'undefined') return undefined
  return window.TradingView && window.TradingView.widget
}

// ?v cache-buster — see git history: a CDN cached the SPA index.html fallback for
// this .js path when the library wasn't deployed. Bump on library updates.
const LIB_URL = '/charting_library/charting_library.standalone.js?v=2'

let _libPromise = null
function loadChartingLibrary() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (tvCtor()) return Promise.resolve()
  if (_libPromise) return _libPromise
  _libPromise = (async () => {
    const res = await fetch(LIB_URL)
    const ct = res.headers.get('content-type') || ''
    if (!res.ok || ct.includes('text/html')) {
      throw new Error('charting_library not found on server (deploy the library files)')
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = LIB_URL
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('charting_library failed to load'))
      document.head.appendChild(s)
    })
    if (!tvCtor()) throw new Error('charting_library did not initialize')
  })().catch((e) => { _libPromise = null; throw e })
  return _libPromise
}

const CHART_SAVE_KEY = 'vxness_chart_layout_v1'

const CHART_BUY_COLOR = '#3b82f6'
const CHART_SELL_COLOR = '#ef4444'
const SL_COLOR = '#f59e0b'
const TP_COLOR = '#14b8a6'
const PROFIT_COLOR = '#3b82f6'
const LOSS_COLOR = '#ef4444'
const BREAKEVEN_COLOR = '#9ca3af'
// Where the on-chart button group sits, from the chart's RIGHT edge (clear of the
// right-axis price/label).
const BTN_RIGHT_PX = 210

const LTP_LINE_OVERRIDES = {
  'mainSeriesProperties.showPriceLine': true,
  'mainSeriesProperties.priceLineWidth': 1,
}

// Instrument digits cache (for price precision on SL/TP labels).
let _digitsMap = {}
fetch(`${API_URL}/prices/instruments`)
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { (d?.instruments || []).forEach((i) => { _digitsMap[String(i.symbol).toUpperCase()] = i.digits }) })
  .catch(() => {})
function digitsFor(sym) {
  const d = _digitsMap[String(sym).toUpperCase()]
  return Number.isFinite(d) ? d : 2
}

function normalizePosition(p) {
  const id = String(p._id || p.id || p.ticket || '')
  const side = String(p.side || p.type || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
  const openPrice = Number(p.openPrice ?? p.entryPrice ?? p.price ?? 0)
  const quantity = Number(p.quantity ?? p.lots ?? p.volume ?? 0)
  const contractSize = Number(p.contractSize) || 100
  const sl = Number(p.sl ?? p.stopLoss ?? 0)
  const tp = Number(p.tp ?? p.takeProfit ?? 0)
  return { id, symbol: String(p.symbol || '').toUpperCase(), side, openPrice, quantity, contractSize, sl, tp }
}

// Live P&L for a position at a given price (matches the panel's math).
function pnlAt(p, price) {
  const q = p.quantity, cs = p.contractSize
  return p.side === 'BUY' ? (price - p.openPrice) * q * cs : (p.openPrice - price) * q * cs
}

export default function ChartingLibraryChart({ symbol = 'XAUUSD', interval = '5', theme = 'dark', positions = [], onRefresh, getQuote }) {
  const containerRef = useRef(null)
  const overlayRef = useRef(null)
  const widgetRef = useRef(null)
  const linesRef = useRef(new Map())
  const appliedSymbolRef = useRef('')
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [dialogValue, setDialogValue] = useState('')

  const symU = String(symbol || 'XAUUSD').toUpperCase()

  const openDialog = (d) => { setDialogValue(d.input?.defaultValue ?? ''); setDialog(d) }

  // Feed the datafeed the SAME price adjuster the panel/instrument list use, so the
  // chart candle == the SELL price exactly (admin spread applied). Cleared on unmount.
  useEffect(() => {
    setQuoteAdjuster(typeof getQuote === 'function' ? getQuote : null)
    return () => setQuoteAdjuster(null)
  }, [getQuote])

  // Swallow the library's benign "Value is null" context-menu rejection.
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

  // Create the widget once (recreate only on theme change).
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setFailed(false)
    linesRef.current.clear()

    loadChartingLibrary().then(() => {
      const Ctor = tvCtor()
      if (cancelled || !containerRef.current || !Ctor) return
      try { widgetRef.current?.remove?.() } catch { /* noop */ }

      let savedData
      try { const s = localStorage.getItem(CHART_SAVE_KEY); if (s) savedData = JSON.parse(s) } catch { /* fresh */ }

      const themeOverrides = theme === 'light'
        ? {
            'paneProperties.background': '#ffffff', 'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': '#ececec', 'paneProperties.horzGridProperties.color': '#ececec',
            'scalesProperties.textColor': '#131722', 'scalesProperties.lineColor': '#e0e3eb',
          }
        : {
            'paneProperties.background': '#0c0e12', 'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': '#1c1f26', 'paneProperties.horzGridProperties.color': '#1c1f26',
            'scalesProperties.textColor': '#b2b5be', 'scalesProperties.lineColor': '#2a2e39',
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
        favorites: { intervals: ['1', '3', '5', '10', '15', '30', '45', '60', '120', '180', '240', '1D', '1W', '1M'] },
        overrides: {
          'symbolWatermarkProperties.transparency': 84,
          'symbolWatermarkProperties.color': theme === 'light' ? 'rgba(40,40,40,0.10)' : 'rgba(200,200,200,0.10)',
          ...themeOverrides,
          ...LTP_LINE_OVERRIDES,
        },
      })
      widgetRef.current = w
      appliedSymbolRef.current = symU
      try {
        w.onChartReady?.(() => {
          if (cancelled) return
          setReady(true)
          try { w.applyOverrides?.(themeOverrides) } catch { /* noop */ }
          try { w.applyOverrides?.(LTP_LINE_OVERRIDES) } catch { /* noop */ }
          try {
            w.subscribe?.('onAutoSaveNeeded', () => {
              try { w.save?.((state) => { try { localStorage.setItem(CHART_SAVE_KEY, JSON.stringify(state)) } catch { /* quota */ } }) } catch { /* noop */ }
            })
          } catch { /* noop */ }
        })
      } catch { /* noop */ }
    }).catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      setReady(false)
      try { widgetRef.current?.remove?.() } catch { /* noop */ }
      widgetRef.current = null
      appliedSymbolRef.current = ''
      linesRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  // Change symbol in place.
  useEffect(() => {
    if (!ready) return
    const w = widgetRef.current
    if (!w?.activeChart || appliedSymbolRef.current === symU) return
    try {
      const chart = w.activeChart()
      for (const [, entry] of linesRef.current) {
        try { if (entry && entry.id != null) chart.removeEntity(entry.id) } catch { /* noop */ }
      }
      linesRef.current.clear()
      chart?.setSymbol?.(symU, () => {})
      appliedSymbolRef.current = symU
    } catch { /* noop */ }
  }, [symU, ready])

  // Reconcile entry / SL / TP LINES from positions (display).
  useEffect(() => {
    const w = widgetRef.current
    if (!ready || !w?.activeChart) return
    let chart
    try { chart = w.activeChart() } catch { return }
    if (!chart?.createShape) return

    const dg = digitsFor(symU)
    const myPos = (positions || []).map(normalizePosition).filter((p) => p.symbol === symU && p.openPrice > 0)
    const pnlColor = (pnl) => (Math.abs(pnl) < 0.10 ? BREAKEVEN_COLOR : pnl > 0 ? PROFIT_COLOR : LOSS_COLOR)

    const desired = []
    for (const p of myPos) {
      const live = priceStreamService.getPrice(p.symbol)
      const cur = live ? (p.side === 'BUY' ? live.bid : live.ask) : p.openPrice
      const pnl = pnlAt(p, cur)
      const sideColor = p.side === 'BUY' ? CHART_BUY_COLOR : CHART_SELL_COLOR
      desired.push({
        key: p.id, price: p.openPrice, color: sideColor, textColor: pnlColor(pnl),
        text: `${p.side} ${p.quantity}  ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`, dashed: false,
      })
      if (p.sl > 0) desired.push({ key: `${p.id}-sl`, price: p.sl, color: SL_COLOR, textColor: SL_COLOR, text: `SL ${p.sl.toFixed(dg)}`, dashed: true })
      if (p.tp > 0) desired.push({ key: `${p.id}-tp`, price: p.tp, color: TP_COLOR, textColor: TP_COLOR, text: `TP ${p.tp.toFixed(dg)}`, dashed: true })
    }

    const shapeOpts = (text, lineColor, textColor, dashed) => ({
      shape: 'horizontal_line', text,
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
          .then((id) => { if (linesRef.current.get(d.key) === entry) { entry.id = id; entry.creating = false } else { try { chart.removeEntity(id) } catch { /* noop */ } } })
          .catch(() => { if (linesRef.current.get(d.key) === entry) linesRef.current.delete(d.key) })
      } else if (existing.id != null) {
        if (existing.price !== d.price) {
          try { chart.getShapeById(existing.id).setPoints([{ time: t, price: d.price }]) } catch { /* noop */ }
          existing.price = d.price
        }
        if (d.text !== existing.text || d.color !== existing.color || d.textColor !== existing.textColor) {
          try { chart.getShapeById(existing.id).setProperties({ text: d.text, linecolor: d.color, textcolor: d.textColor }) } catch { /* noop */ }
          existing.text = d.text; existing.color = d.color; existing.textColor = d.textColor
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

  // Stable key of open positions on this symbol — the drag-button overlay rebuilds
  // only when the position SET changes, not every tick.
  const positionsKey = (positions || [])
    .map(normalizePosition)
    .filter((p) => p.symbol === symU)
    .map((p) => `${p.id}:${p.side}:${p.quantity}`)
    .join('|')

  // On-chart drag-to-set SL/TP + close (✕) buttons pinned to each entry line.
  // Ported from SwisDex: this Charting Library build exposes no priceToCoordinate,
  // so we calibrate price→pixel from the chart's OWN crosshair + price scale.
  useEffect(() => {
    const w = widgetRef.current
    const overlay = overlayRef.current
    if (!ready || !w?.activeChart || !overlay) return
    let chart
    try { chart = w.activeChart() } catch { return }
    if (!chart?.crossHairMoved) return

    const dg = digitsFor(symU)

    // price ↔ pixel geometry
    const geom = () => {
      try {
        const pane = chart.getPanes?.()[0]
        const ps = pane?.getMainSourcePriceScale?.()
        if (!ps) return null
        const mode = ps.getMode?.() ?? 0
        if (mode !== 0 && mode !== 1) return null
        const range = ps.getVisiblePriceRange?.()
        const h = pane?.getHeight?.() || 0
        if (!range || !(h > 0) || !(range.to > range.from)) return null
        if (mode === 1 && !(range.from > 0)) return null
        return { top: range.to, bottom: range.from, h, log: mode === 1 }
      } catch { return null }
    }
    const paneY = (price, g) => {
      if (g.log) { if (!(price > 0)) return NaN; const lt = Math.log(g.top), lb = Math.log(g.bottom); return (g.h * (lt - Math.log(price))) / (lt - lb) }
      return (g.h * (g.top - price)) / (g.top - g.bottom)
    }
    let calibOffset = null
    const onCross = (p) => {
      if (!p || typeof p.price !== 'number' || typeof p.offsetY !== 'number') return
      const g = geom(); if (!g) return
      const py = paneY(p.price, g)
      if (Number.isFinite(py)) calibOffset = p.offsetY - py
    }
    let crossSub = null
    try { crossSub = chart.crossHairMoved(); crossSub?.subscribe?.(null, onCross) } catch { /* noop */ }
    const priceForY = (containerY) => {
      const g = geom(); if (!g || calibOffset == null) return null
      const py = containerY - calibOffset
      if (g.log) { const lt = Math.log(g.top), lb = Math.log(g.bottom); return Math.exp(lt - (py / g.h) * (lt - lb)) }
      return g.top - (py / g.h) * (g.top - g.bottom)
    }

    // Save an SL/TP bracket — sends BOTH brackets (vxness wipes an omitted one).
    const saveBracket = async (p, kind, price) => {
      try {
        const body = {
          tradeId: p.id,
          sl: kind === 'sl' ? price : (p.sl > 0 ? p.sl : null),
          tp: kind === 'tp' ? price : (p.tp > 0 ? p.tp : null),
        }
        const res = await fetch(`${API_URL}/trade/modify`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await res.json().catch(() => ({}))
        if (data?.success === false) throw new Error(data.message || 'Modify failed')
        onRefresh?.()
      } catch (e) { openDialog({ title: 'Error', body: (e && e.message) || 'Failed to set', confirmLabel: 'OK', onConfirm: () => {} }) }
    }
    const closePos = async (p) => {
      try {
        const t = priceStreamService.getPrice(p.symbol)
        if (!t || !(t.bid > 0) || !(t.ask > 0)) throw new Error('Price not available')
        const res = await fetch(`${API_URL}/trade/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: p.id, bid: t.bid, ask: t.ask }) })
        const data = await res.json().catch(() => ({}))
        if (data?.success === false) throw new Error(data.message || 'Close failed')
        onRefresh?.()
      } catch (e) { openDialog({ title: 'Error', body: (e && e.message) || 'Close failed', confirmLabel: 'OK', onConfirm: () => {} }) }
    }

    const mkBtn = (txt, bg, title, onClick) => {
      const b = document.createElement('button')
      b.type = 'button'; b.textContent = txt; b.title = title
      b.style.cssText = `display:flex;align-items:center;justify-content:center;height:18px;min-width:18px;padding:0 ${txt.length > 1 ? '5' : '0'}px;border:0;border-radius:3px;cursor:pointer;font-size:10px;font-weight:700;line-height:1;color:#fff;pointer-events:auto;background:${bg};box-shadow:0 1px 3px rgba(0,0,0,.55);`
      b.onmouseenter = () => { b.style.filter = 'brightness(1.15)' }
      b.onmouseleave = () => { b.style.filter = 'none' }
      b.onclick = (e) => { e.stopPropagation(); onClick() }
      return b
    }

    // Draggable SL/TP button: press & drag up/down → dashed preview → release → confirm → save.
    const mkDragBtn = (txt, bg, title, p, kind) => {
      const color = kind === 'sl' ? SL_COLOR : TP_COLOR
      const zoneBg = kind === 'sl' ? 'rgba(239,68,68,0.13)' : 'rgba(20,184,166,0.13)'
      const b = document.createElement('button')
      b.type = 'button'; b.textContent = txt; b.title = `${title} — drag up/down to set, or click to type`
      b.style.cssText = `display:flex;align-items:center;justify-content:center;height:18px;min-width:18px;padding:0 5px;border:0;border-radius:3px;cursor:ns-resize;font-size:10px;font-weight:700;line-height:1;color:#fff;pointer-events:auto;background:${bg};box-shadow:0 1px 3px rgba(0,0,0,.55);`
      b.onmouseenter = () => { b.style.filter = 'brightness(1.15)' }
      b.onmouseleave = () => { b.style.filter = 'none' }
      b.onpointerdown = (e) => {
        e.preventDefault(); e.stopPropagation()
        try { b.setPointerCapture(e.pointerId) } catch { /* noop */ }
        const startY = e.clientY
        let moved = false
        const zone = document.createElement('div'); zone.style.cssText = `position:absolute;left:0;right:0;top:0;height:0;background:${zoneBg};pointer-events:none;z-index:6;`
        const line = document.createElement('div'); line.style.cssText = `position:absolute;left:0;right:0;top:0;height:0;border-top:1px dashed ${color};pointer-events:none;z-index:7;`
        const lbl = document.createElement('div'); lbl.style.cssText = `position:absolute;right:2px;top:0;transform:translateY(-50%);background:${color};color:#fff;font:700 10px system-ui;padding:1px 6px;border-radius:3px;pointer-events:none;z-index:8;white-space:nowrap;`
        overlay.appendChild(zone); overlay.appendChild(line); overlay.appendChild(lbl)
        const entryY = () => { const g = geom(); if (!g || calibOffset == null) return null; return paneY(p.openPrice, g) + calibOffset }
        const cleanup = () => { for (const el of [zone, line, lbl]) { try { overlay.removeChild(el) } catch { /* noop */ } } }
        b.onpointermove = (ev) => {
          if (Math.abs(ev.clientY - startY) > 3) moved = true
          const r = containerRef.current?.getBoundingClientRect(); if (!r) return
          const cy = ev.clientY - r.top
          const price = priceForY(cy)
          line.style.top = `${cy}px`; lbl.style.top = `${cy}px`
          let ptxt = `${kind === 'sl' ? 'SL' : 'TP'} ${price ? price.toFixed(dg) : '—'}`
          if (price) { const pl = pnlAt(p, price); ptxt += `  ${pl >= 0 ? '+' : '-'}$${Math.abs(pl).toFixed(2)}` }
          lbl.textContent = ptxt
          const ey = entryY(); if (ey != null) { zone.style.top = `${Math.min(ey, cy)}px`; zone.style.height = `${Math.abs(ey - cy)}px` }
        }
        b.onpointerup = (ev) => {
          b.onpointermove = null; b.onpointerup = null
          try { b.releasePointerCapture(ev.pointerId) } catch { /* noop */ }
          cleanup()
          if (!moved) { // plain click → type a price
            const cur = kind === 'sl' ? (p.sl || '') : (p.tp || '')
            openDialog({
              title: `${kind === 'sl' ? 'Stop Loss' : 'Take Profit'} — ${p.side} ${p.quantity} ${symU}`,
              body: 'Enter the price. Leave blank to remove.',
              confirmLabel: 'Save',
              input: { defaultValue: cur ? Number(cur).toFixed(dg) : '', placeholder: 'Price' },
              onConfirm: (raw) => { const v = (raw ?? '').trim(); const val = v === '' ? null : parseFloat(v); if (val !== null && !(val > 0)) return; saveBracket(p, kind, val) },
            })
            return
          }
          const r = containerRef.current?.getBoundingClientRect()
          const price = r ? priceForY(ev.clientY - r.top) : null
          if (!price || !(price > 0)) return
          const rounded = Number(price.toFixed(dg))
          const pl = pnlAt(p, rounded)
          openDialog({
            title: `Set ${kind === 'sl' ? 'Stop Loss' : 'Take Profit'} @ ${rounded.toFixed(dg)}`,
            body: `${p.side} ${p.quantity} ${symU} → ${pl >= 0 ? 'profit' : 'loss'} ${pl >= 0 ? '+' : '-'}$${Math.abs(pl).toFixed(2)}`,
            confirmLabel: `Set ${kind.toUpperCase()}`,
            onConfirm: () => saveBracket(p, kind, rounded),
          })
        }
      }
      return b
    }

    const myPos = (positions || []).map(normalizePosition).filter((p) => p.symbol === symU && p.openPrice > 0)
    const btns = []
    for (const p of myPos) {
      const sideColor = p.side === 'BUY' ? CHART_BUY_COLOR : CHART_SELL_COLOR
      const root = document.createElement('div')
      root.style.cssText = `position:absolute;right:${BTN_RIGHT_PX}px;transform:translateY(-50%);display:flex;align-items:center;gap:3px;pointer-events:none;visibility:hidden;z-index:6;`
      root.appendChild(mkDragBtn('SL', 'rgba(245,158,11,0.97)', `Stop loss ${p.side} ${p.quantity} ${symU}`, p, 'sl'))
      root.appendChild(mkDragBtn('TP', 'rgba(20,184,166,0.97)', `Take profit ${p.side} ${p.quantity} ${symU}`, p, 'tp'))
      root.appendChild(mkBtn('✕', sideColor, `Close ${p.side} ${p.quantity} ${symU}`, () => {
        openDialog({ title: 'Close position', body: `Close ${p.side} ${p.quantity} ${symU} at market?`, confirmLabel: 'Close', danger: true, onConfirm: () => closePos(p) })
      }))
      overlay.appendChild(root)
      btns.push({ p, el: root })
    }
    if (btns.length === 0) { try { crossSub?.unsubscribe?.(null, onCross) } catch { /* noop */ } return () => {} }

    let raf = 0
    const sync = () => {
      raf = requestAnimationFrame(sync)
      const g = geom()
      if (!g || calibOffset == null) { for (const b of btns) b.el.style.visibility = 'hidden'; return }
      const h = containerRef.current?.clientHeight || g.h
      for (const b of btns) {
        const y = paneY(b.p.openPrice, g) + calibOffset
        if (!(y > 8) || y > h - 8) b.el.style.visibility = 'hidden'
        else { b.el.style.top = `${y}px`; b.el.style.visibility = 'visible' }
      }
    }
    raf = requestAnimationFrame(sync)

    return () => {
      cancelAnimationFrame(raf)
      try { crossSub?.unsubscribe?.(null, onCross) } catch { /* noop */ }
      for (const b of btns) { try { overlay.removeChild(b.el) } catch { /* noop */ } }
    }
  }, [ready, symU, positionsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const dark = theme !== 'light'
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* vxness logo watermark — faint, centered, non-interactive. Sits over the
          chart canvas but under the SL/TP overlay (DOM order). */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', overflow: 'hidden' }}>
        <img
          src={logoImage}
          alt=""
          aria-hidden
          draggable={false}
          style={{ width: '38%', maxWidth: 300, objectFit: 'contain', opacity: dark ? 0.07 : 0.05, userSelect: 'none' }}
        />
      </div>
      <div ref={overlayRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} />
      {failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: dark ? '#9ca3af' : '#6b7280', fontSize: 14, textAlign: 'center', padding: 16 }}>
          Chart could not load. The charting library assets may be missing from /charting_library/. Please refresh, or contact support.
        </div>
      )}
      {dialog && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646 }}>
          <div onClick={() => setDialog(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onMouseDown={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 320, borderRadius: 12, padding: 16, background: dark ? '#15181d' : '#ffffff', border: `1px solid ${dark ? '#2a2e39' : '#e5e7eb'}`, color: dark ? '#e5e7eb' : '#111827', boxShadow: '0 10px 40px rgba(0,0,0,.5)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{dialog.title}</h3>
              <p style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>{dialog.body}</p>
              {dialog.input && (
                <input autoFocus type="number" step="any" value={dialogValue}
                  onChange={(e) => setDialogValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const d = dialog; setDialog(null); d.onConfirm(dialogValue) } else if (e.key === 'Escape') setDialog(null) }}
                  placeholder={dialog.input.placeholder}
                  style={{ width: '100%', marginBottom: 12, padding: '8px 12px', borderRadius: 8, border: `1px solid ${dark ? '#2a2e39' : '#d1d5db'}`, background: dark ? '#0c0e12' : '#f9fafb', color: 'inherit', fontFamily: 'monospace', fontSize: 14, outline: 'none' }} />
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setDialog(null)} style={{ flex: 1, padding: '10px 0', fontWeight: 700, borderRadius: 8, fontSize: 13, border: 0, cursor: 'pointer', background: dark ? '#2a2e39' : '#e5e7eb', color: dark ? '#e5e7eb' : '#111827' }}>Cancel</button>
                <button type="button" onClick={() => { const d = dialog; setDialog(null); d.onConfirm(dialogValue) }} style={{ flex: 1, padding: '10px 0', fontWeight: 700, borderRadius: 8, fontSize: 13, border: 0, cursor: 'pointer', color: '#fff', background: dialog.danger ? '#ef4444' : '#3b82f6' }}>{dialog.confirmLabel}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
