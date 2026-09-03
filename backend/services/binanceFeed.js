// Live crypto from Binance's PUBLIC combined bookTicker stream.
//
// Why a second feed at all: the primary vendor pushes depth roughly once a
// second, which is fine for a forex cross and far too slow for BTC. Binance's
// @bookTicker pushes the best bid/ask on every change — several per second per
// symbol — and needs no API key.
//
// The symbols listed here are REMOVED from the primary feed's subscription (see
// infowayService.CRYPTO_SYMBOLS filtering), so every symbol has exactly one
// live source. Two sources for one symbol would have the quote flip between
// them tick by tick, and a trade could fill against whichever arrived last.
//
// Prices are handed to infowayService.ingestExternalPrice() rather than kept
// here: the whole platform reads quotes through that one price map and
// subscriber list, so nothing downstream — trade engine, bar aggregator, the
// hubs — needs to know a second feed exists.

import WebSocket from 'ws'

// Toggle with BINANCE_FEED=off. Default on.
export const BINANCE_FEED_ENABLED =
  String(process.env.BINANCE_FEED || '').toLowerCase() !== 'off' &&
  String(process.env.BINANCE_FEED || '').toLowerCase() !== 'false'

// Platform symbol -> Binance stream symbol. Only the majors move over; the long
// tail stays on the primary feed, which is the only place some of them exist.
export const BINANCE_SYMBOLS = {
  BTCUSD: 'btcusdt',
  ETHUSD: 'ethusdt',
  LTCUSD: 'ltcusdt',
  XRPUSD: 'xrpusdt',
  SOLUSD: 'solusdt',
}

const STREAM_URL =
  'wss://stream.binance.com:9443/stream?streams=' +
  Object.values(BINANCE_SYMBOLS).map((s) => `${s}@bookTicker`).join('/')

const FROM_BINANCE = Object.fromEntries(
  Object.entries(BINANCE_SYMBOLS).map(([platform, b]) => [b.toUpperCase(), platform]),
)

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const STALE_AFTER_MS = 60000

class BinanceFeed {
  constructor() {
    this.ws = null
    this.attempts = 0
    this.lastMessageAt = 0
    this.shutdown = false
    this.onPrice = null
    this.watchdog = null
  }

  // `handler(symbol, {bid, ask, time})` — infowayService.ingestExternalPrice.
  start(handler) {
    if (!BINANCE_FEED_ENABLED) {
      console.log('[Binance] disabled (BINANCE_FEED=off) — crypto stays on the primary feed')
      return false
    }
    this.onPrice = handler
    this.connect()
    this.startWatchdog()
    return true
  }

  connect() {
    if (this.shutdown) return
    let ws
    try {
      ws = new WebSocket(STREAM_URL)
    } catch (e) {
      console.error('[Binance] construct error:', e.message)
      return this.scheduleReconnect()
    }
    this.ws = ws

    ws.on('open', () => {
      this.attempts = 0
      this.lastMessageAt = Date.now()
      console.log(`[Binance] connected — ${Object.keys(BINANCE_SYMBOLS).length} crypto symbols on bookTicker`)
    })

    ws.on('message', (raw) => {
      this.lastMessageAt = Date.now()
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      // Combined streams wrap the payload: {stream, data:{s,b,B,a,A,u}}
      const d = msg?.data || msg
      const symbol = FROM_BINANCE[String(d?.s || '').toUpperCase()]
      if (!symbol) return

      const bid = parseFloat(d.b)
      const ask = parseFloat(d.a)
      // A crossed or zero book is not a quote. Publishing one would let a trade
      // open at a price that never existed.
      if (!(bid > 0) || !(ask > 0) || ask < bid) return

      this.onPrice?.(symbol, { bid, ask, time: Date.now() })
    })

    ws.on('close', (code) => {
      if (this.shutdown) return
      console.error(`[Binance] socket closed (code=${code})`)
      this.scheduleReconnect()
    })

    ws.on('error', (e) => {
      console.error('[Binance] socket error:', e.message)
      try { ws.close() } catch { /* ignore */ }
    })
  }

  scheduleReconnect() {
    if (this.shutdown) return
    this.attempts += 1
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.attempts - 1), RECONNECT_MAX_MS)
    setTimeout(() => this.connect(), delay)
  }

  // Crypto trades around the clock, so silence here always means a broken
  // socket — unlike the forex feed, there is no weekend to allow for.
  startWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = setInterval(() => {
      if (this.shutdown || !this.lastMessageAt) return
      if (Date.now() - this.lastMessageAt > STALE_AFTER_MS) {
        console.error('[Binance] no data for 60s — reconnecting')
        this.lastMessageAt = Date.now()
        try { this.ws?.close() } catch { /* ignore */ }
      }
    }, 15000)
  }

  stop() {
    this.shutdown = true
    if (this.watchdog) clearInterval(this.watchdog)
    try { this.ws?.close() } catch { /* ignore */ }
  }
}

export default new BinanceFeed()
