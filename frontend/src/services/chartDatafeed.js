// TradingView Charting Library datafeed adapter (IBasicDataFeed implementation).
// Historical bars come from backend /api/charts/* (UDF protocol).
// Real-time bars are built locally from Socket.IO tick stream so the chart's
// last price always matches the order panel (same broker, same MetaApi LP).
import { API_URL } from '../config/api'
import priceStream from './priceStream'

const RESOLUTION_TO_SECONDS = {
  '1': 60, '5': 300, '15': 900, '30': 1800,
  '60': 3600, '240': 14400,
  'D': 86400, '1D': 86400,
  'W': 604800, '1W': 604800,
  'M': 2592000, '1M': 2592000,
}

// Per-active-subscription state used to fold ticks into the current bar.
class BarAggregator {
  constructor(resolution, onBar) {
    this.stepMs = (RESOLUTION_TO_SECONDS[resolution] || 60) * 1000
    this.onBar = onBar
    this.currentBar = null
  }

  // align ts (ms) to the start of its bar window
  alignToBar(ts) {
    return Math.floor(ts / this.stepMs) * this.stepMs
  }

  pushTick(midPrice, tsMs) {
    if (!Number.isFinite(midPrice)) return
    const t = this.alignToBar(tsMs)
    if (!this.currentBar || this.currentBar.time !== t) {
      // open a new bar carrying forward the previous close
      const open = this.currentBar ? this.currentBar.close : midPrice
      this.currentBar = { time: t, open, high: midPrice, low: midPrice, close: midPrice, volume: 0 }
    } else {
      this.currentBar.high = Math.max(this.currentBar.high, midPrice)
      this.currentBar.low = Math.min(this.currentBar.low, midPrice)
      this.currentBar.close = midPrice
    }
    this.onBar({ ...this.currentBar })
  }

  // Seed the aggregator from the most recent historical bar so a fresh tick doesn't
  // open a bar with the tick price as the "open" — gives a continuous chart.
  seed(lastBar) {
    if (!lastBar) return
    this.currentBar = {
      time: lastBar.time,
      open: lastBar.open,
      high: lastBar.high,
      low: lastBar.low,
      close: lastBar.close,
      volume: lastBar.volume || 0,
    }
  }
}

const activeSubscriptions = new Map()
let priceStreamSubId = null

function ensurePriceStreamRouting() {
  if (priceStreamSubId) return
  priceStreamSubId = `chart-datafeed-${Date.now()}`
  priceStream.subscribe(priceStreamSubId, (prices, updated, timestamp) => {
    const now = timestamp || Date.now()
    // Fan out per active subscription
    activeSubscriptions.forEach(({ symbol, aggregator }) => {
      const p = prices[symbol]
      if (!p) return
      const mid = (Number(p.bid) + Number(p.ask)) / 2
      aggregator.pushTick(mid, now)
    })
  })
}

function teardownPriceStreamRoutingIfIdle() {
  if (priceStreamSubId && activeSubscriptions.size === 0) {
    priceStream.unsubscribe(priceStreamSubId)
    priceStreamSubId = null
  }
}

const datafeed = {
  onReady(callback) {
    fetch(`${API_URL}/charts/config`)
      .then(r => r.json())
      .then(config => setTimeout(() => callback(config), 0))
      .catch(err => {
        console.error('[datafeed] onReady error:', err)
        setTimeout(() => callback({
          supported_resolutions: ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M'],
          supports_time: true,
        }), 0)
      })
  },

  searchSymbols(userInput, exchange, symbolType, onResult) {
    const url = `${API_URL}/charts/search?query=${encodeURIComponent(userInput)}&type=${encodeURIComponent(symbolType || '')}&limit=30`
    fetch(url)
      .then(r => r.json())
      .then(results => onResult(results || []))
      .catch(err => { console.error('[datafeed] searchSymbols error:', err); onResult([]) })
  },

  resolveSymbol(symbolName, onSymbolResolved, onResolveError) {
    const symbol = symbolName.includes(':') ? symbolName.split(':')[1] : symbolName
    fetch(`${API_URL}/charts/symbols?symbol=${encodeURIComponent(symbol)}`)
      .then(r => r.json())
      .then(info => {
        if (!info || info.s === 'error') {
          onResolveError(info?.errmsg || `Cannot resolve ${symbolName}`)
          return
        }
        // Library expects synchronous-feeling resolution
        setTimeout(() => onSymbolResolved(info), 0)
      })
      .catch(err => onResolveError(err.message))
  },

  getBars(symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) {
    const { from, to, countBack, firstDataRequest } = periodParams
    const params = new URLSearchParams({
      symbol: symbolInfo.name,
      resolution: String(resolution),
      from: String(from),
      to: String(to),
    })
    if (countBack) params.set('countback', String(countBack))

    fetch(`${API_URL}/charts/history?${params.toString()}`)
      .then(r => r.json())
      .then(payload => {
        if (payload.s === 'no_data') {
          onHistoryCallback([], { noData: true, nextTime: payload.nextTime })
          return
        }
        if (payload.s !== 'ok') {
          onErrorCallback(payload.errmsg || 'Unknown error from /history')
          return
        }
        const bars = payload.t.map((t, i) => ({
          time: t * 1000, // Charting Library uses ms
          open: payload.o[i],
          high: payload.h[i],
          low: payload.l[i],
          close: payload.c[i],
          volume: payload.v?.[i] || 0,
        }))
        // On the first request, seed the aggregator with the last bar so tick-based
        // bar continuation has a sensible "open" carried forward.
        if (firstDataRequest && bars.length) {
          const subKey = `${symbolInfo.name}::${resolution}`
          const sub = [...activeSubscriptions.values()].find(s => s.subKey === subKey)
          sub?.aggregator?.seed(bars[bars.length - 1])
        }
        onHistoryCallback(bars, { noData: false })
      })
      .catch(err => {
        console.error('[datafeed] getBars error:', err)
        onErrorCallback(err.message)
      })
  },

  subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) {
    const subKey = `${symbolInfo.name}::${resolution}`
    const aggregator = new BarAggregator(resolution, (bar) => {
      onRealtimeCallback({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })
    })
    activeSubscriptions.set(subscriberUID, {
      symbol: symbolInfo.name,
      resolution,
      subKey,
      aggregator,
    })
    ensurePriceStreamRouting()
  },

  unsubscribeBars(subscriberUID) {
    activeSubscriptions.delete(subscriberUID)
    teardownPriceStreamRoutingIfIdle()
  },

  getServerTime(callback) {
    fetch(`${API_URL}/charts/time`)
      .then(r => r.text())
      .then(t => callback(parseInt(t, 10)))
      .catch(err => { console.error('[datafeed] getServerTime error:', err); callback(Math.floor(Date.now() / 1000)) })
  },
}

export default datafeed
