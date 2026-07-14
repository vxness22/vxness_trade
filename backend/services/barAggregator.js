import { EventEmitter } from 'events'

// In-memory OHLC bar aggregator — a faithful port of SwisDex's
// market-data/src/bar_aggregator.py, adapted to vxness's Infoway tick feed.
//
// Bars are built from the tick MID ((bid+ask)/2), exactly like SwisDex. The
// chart shifts them down to the BID on the frontend (see chartingDatafeed.js),
// so the candle last-price == the panel BID == a buy position's current price.
//
// Timeframe seconds — the canonical set used everywhere in the chart pipeline.
export const TIMEFRAMES = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
}

class BarAggregator extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(0)
    // key `${symbol}:${tf}` -> { time, open, high, low, close, volume, tickCount }
    // `time` is bar-start in epoch SECONDS. `volume` == tick count (there is no
    // real traded volume on a broker feed).
    this.current = new Map()
  }

  key(symbol, tf) {
    return `${symbol}:${tf}`
  }

  /**
   * Feed one tick. For every timeframe: snap the tick onto the TF grid; if that
   * opens a new window the previous bar is final (history REST re-serves it from
   * Infoway), otherwise fold the mid into the current bar. Emits a `bar` event
   * with the in-progress candle so the /ws/bars hub can stream it live.
   */
  update(symbol, bid, ask, tsMs) {
    if (!(bid > 0) || !(ask > 0)) return
    const mid = (bid + ask) / 2
    const epoch = Math.floor((Number(tsMs) || Date.now()) / 1000)

    for (const tf of Object.keys(TIMEFRAMES)) {
      const secs = TIMEFRAMES[tf]
      const barStart = Math.floor(epoch / secs) * secs
      const k = this.key(symbol, tf)
      let bar = this.current.get(k)

      if (!bar || bar.time !== barStart) {
        bar = { time: barStart, open: mid, high: mid, low: mid, close: mid, volume: 0, tickCount: 0 }
        this.current.set(k, bar)
      } else {
        if (mid > bar.high) bar.high = mid
        if (mid < bar.low) bar.low = mid
        bar.close = mid
      }
      bar.tickCount += 1
      bar.volume = bar.tickCount

      this.emit('bar', symbol, tf, {
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })
    }
  }

  /** The current in-progress bar for (symbol, tf), or null. */
  getCurrent(symbol, tf) {
    const bar = this.current.get(this.key(symbol, tf))
    if (!bar) return null
    return {
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }
  }
}

const barAggregator = new BarAggregator()
export default barAggregator
