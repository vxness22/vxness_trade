import { EventEmitter } from 'events'
import { SESSION_START_HOUR_NY, barStartSeconds, dailyBarSeconds } from '../utils/sessionGrid.js'
import { classify } from '../utils/symbolMeta.js'

// In-memory OHLC bar aggregator — a faithful port of SwisDex's
// market-data/src/bar_aggregator.py, adapted to vxness's Infoway tick feed.
//
// Bars are built from the tick MID ((bid+ask)/2), exactly like SwisDex — and the
// chart plots that mid unchanged (see chartingDatafeed.js), because it is also
// what Infoway's klines and TradingView's own series are quoted at.
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

    // Bars start where the REST history says they start — anchored at 17:00 New
    // York, not at UTC midnight (see utils/sessionGrid.js). A live candle on a
    // different grid than the history behind it is the one thing this hub must
    // never emit, since the chart would draw the forming bar beside the gap the
    // history left rather than inside it.
    const anchor = classify(symbol) === 'crypto' ? null : SESSION_START_HOUR_NY

    for (const tf of Object.keys(TIMEFRAMES)) {
      const secs = TIMEFRAMES[tf]
      const barStart = tf === '1d'
        ? dailyBarSeconds(epoch, anchor)
        : barStartSeconds(epoch, secs, anchor)
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
