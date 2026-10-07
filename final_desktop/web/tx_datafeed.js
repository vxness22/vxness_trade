/*
 * Vxness datafeed for TradingView Advanced Charts.
 *
 * Data flows over the Qt WebChannel bridge object `sc` (exposed by the C++
 * ChartBridge), which reuses the app's authenticated ApiClient / PriceStream.
 *
 * This datafeed obeys the platform's chart golden rules (see CHART.md):
 *   1. Never invent prices. There is NO synthetic / random-walk fallback. If
 *      the backend has no bars, the chart honestly ends at the last real bar
 *      (noData) — it does not draw fake candles.
 *   2. One price basis. History + live candle both come from the same feed.
 *   3. Candles are drawn at BID. The backend aggregates MID bars; we shift
 *      them down by half the live spread so
 *      chart last price == panel BID == buy-position current price (MT5).
 *   4. Weekends stay blank for non-crypto: Sat/Sun bars are dropped.
 *
 * Bridge contract (C++ side):
 *   property  string  symbolsJson        // JSON array of symbol specs
 *   invokable requestBars(sym, res, fromSec, toSec, reqId)
 *   signal    barsReady(reqId, barsJson) // bars for a requestBars() call
 *   signal    tick(sym, bid, ask, tsMs)  // live tick
 */

const TF_MAP = {
  "1": "1m", "5": "5m", "15": "15m", "30": "30m",
  "60": "1h", "240": "4h", "1D": "1d", "D": "1d",
};

const RES_SEC = { "1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600, "240": 14400, "1D": 86400, "D": 86400 };

// Everything the timeframe toolbar offers. The server only aggregates the base
// resolutions (INTRADAY_MULTIPLIERS + 1D); TradingView builds the extras
// (3m, 10m, 45m, 2h, 3h) and W/M on the client from those — see CHART.md §3.
const SUPPORTED_RESOLUTIONS = [
  "1", "3", "5", "10", "15", "30", "45", "60", "120", "180", "240", "1D", "1W", "1M",
];
const INTRADAY_MULTIPLIERS = ["1", "5", "15", "30", "60", "240"];

// Map a TradingView resolution to a server timeframe. TradingView normally
// asks only for the base multipliers, but if it ever requests an in-between
// step, fall back to the nearest base the aggregator actually stores.
function resToTf(res) {
  const r = String(res);
  if (TF_MAP[r]) return TF_MAP[r];
  if (/^\d+$/.test(r)) {
    const m = parseInt(r);
    if (m <= 1)   return "1m";
    if (m <= 5)   return "5m";
    if (m <= 15)  return "15m";
    if (m <= 30)  return "30m";
    if (m <= 60)  return "1h";
    if (m <= 240) return "4h";
  }
  return "1d";   // D / W / M
}

function isCrypto(sym) {
  return /BTC|ETH|LTC|XRP|SOL|DOGE|BNB|ADA/.test((sym || "").toUpperCase());
}

// ── Price basis and session grid — the same as the web terminal's chart ──
//
// Both history (Infoway klines) and the forming candle are the raw feed MID.
// That is what the web chart plots (frontend/src/services/chartingDatafeed.js)
// and what matches TradingView candle for candle. This chart used to shift
// history down by half the ACCOUNT's spread to land on the bid — which, with an
// admin spread, was neither the raw bid nor anything the web showed, so the two
// terminals drew different candles for the same symbol.
//
// Bars start where the server's history says they start: 17:00 New York for
// the FX week, the plain UTC grid for crypto. A copy of backend/utils/
// sessionGrid.js (and the web's frontend/src/utils/sessionGrid.js) — keep all
// three in step.
const SESSION_START_HOUR_NY = 17;
const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function newYorkFields(ms) {
  const out = {};
  for (const p of NY_PARTS.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = parseInt(p.value, 10);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}
function newYorkOffsetSeconds(tsSec) {
  const ms = tsSec * 1000;
  const f = newYorkFields(ms);
  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return Math.round((asIfUtc - Math.floor(ms / 1000) * 1000) / 1000);
}
function sessionStartSeconds(tsSec, anchor) {
  if (anchor == null) return null;
  const offset = newYorkOffsetSeconds(tsSec);
  const nySecOfDay = (((tsSec + offset) % 86400) + 86400) % 86400;
  let elapsed = nySecOfDay - anchor * 3600;
  if (elapsed < 0) elapsed += 86400;
  return tsSec - elapsed;
}
function barStartSeconds(tsSec, periodSec, anchor) {
  if (!(periodSec > 0)) return tsSec;
  const a = sessionStartSeconds(tsSec, anchor);
  if (a == null) return Math.floor(tsSec / periodSec) * periodSec;
  return a + Math.floor((tsSec - a) / periodSec) * periodSec;
}
function sessionTradingDate(tsSec, anchor) {
  const a = sessionStartSeconds(tsSec, anchor);
  if (a == null) return new Date(Math.floor(tsSec / 86400) * 86400 * 1000).toISOString().slice(0, 10);
  const f = newYorkFields((a + 12 * 3600) * 1000);
  return f.year + "-" + String(f.month).padStart(2, "0") + "-" + String(f.day).padStart(2, "0");
}
function isClosedSession(tsSec, anchor) {
  if (anchor == null) return false;
  const day = new Date(sessionTradingDate(tsSec, anchor) + "T00:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

// Drop bars from a session the instrument is shut for (Friday 17:00 to Sunday
// 17:00 New York). The old rule dropped every UTC Saturday/Sunday bar, which
// also deleted the Sunday-evening open — real trading, labelled Monday.
function dropClosedSessionBars(bars, anchor) {
  if (anchor == null) return bars;
  return bars.filter(b => !isClosedSession(Math.floor(b.time / 1000), anchor));
}

function makeDatafeed(bridge) {
  let symbolsMeta = {};
  // /symbols usually answers AFTER the page has booted, so re-read on every
  // symbolsChanged — otherwise resolveSymbol() falls back to 5 digits and the
  // price scale is wrong for gold, indices and JPY pairs.
  function loadMeta() {
    try {
      const next = {};
      JSON.parse(bridge.symbolsJson || "[]").forEach(s => { next[s.symbol] = s; });
      symbolsMeta = next;
    } catch (e) { console.warn("symbolsJson parse failed", e); }
  }
  loadMeta();
  bridge.symbolsChanged.connect(loadMeta);

  const pendingBars = {};   // reqId -> {onResult, onError, from, to, res, symbol, timer}
  let reqSeq = 0;
  // The newest bar each history reply ended on, so a forming candle continues
  // it — carrying its real open/high/low — instead of restarting the current
  // bar from the first tick it sees.
  const lastHistBar = {};   // `${symbol}|${resolution}` -> bar

  function anchorFor(sym) {
    const meta = symbolsMeta[sym];
    const cat = String(meta && meta.category || "").toLowerCase();
    return (cat === "crypto" || (!cat && isCrypto(sym))) ? null : SESSION_START_HOUR_NY;
  }

  const resetCbs = {};        // guid -> onResetCacheNeededCallback

  bridge.barsReady.connect((reqId, barsJson) => {
    const req = pendingBars[reqId];
    if (!req) return;
    if (req.timer) clearTimeout(req.timer);
    delete pendingBars[reqId];
    let bars = [];
    try { bars = JSON.parse(barsJson) || []; } catch (e) { req.onError("parse error"); return; }

    // Ascending, bounded above by `to` only — never floored on `from`, or a
    // closed weekend window would blank the chart.
    let out = bars
      .map(b => ({
        time:   Date.parse(b.time),          // ms
        open:   b.open, high: b.high,
        low:    b.low,  close: b.close,
        volume: b.volume,
      }))
      .filter(b => !isNaN(b.time) && (!req.to || b.time / 1000 <= req.to))
      .sort((a, b) => a.time - b.time);

    out = dropClosedSessionBars(out, anchorFor(req.symbol));
    if (out.length) lastHistBar[req.symbol + "|" + req.res] = Object.assign({}, out[out.length - 1]);
    req.onResult(out, { noData: out.length === 0 });
  });

  // --- live tick fan-out to subscribed charts ---
  const subs = {};   // guid -> {symbol, res, resSec, onTick, lastBar}

  function resolutionToSec(res) {
    const r = String(res);
    if (/^\d+$/.test(r))   return parseInt(r) * 60;              // minutes
    if (/^\d*D$/.test(r))  return (parseInt(r) || 1) * 86400;
    if (/^\d*W$/.test(r))  return (parseInt(r) || 1) * 604800;
    if (/^\d*M$/.test(r))  return (parseInt(r) || 1) * 2592000;
    return 300;
  }

  // Where the bar containing `tsSec` starts, in ms — the server's grid: the
  // session-anchored intraday grid, and for daily and slower the trading date
  // stamped at midnight UTC (Monday for weeks, the 1st for months).
  function bucketMs(tsSec, res, resSec, anchor) {
    const r = String(res);
    if (resSec < 86400) return barStartSeconds(tsSec, resSec, anchor) * 1000;
    const date = sessionTradingDate(tsSec, anchor);
    let day = Date.parse(date + "T00:00:00Z");
    if (/W$/.test(r)) day -= ((new Date(day).getUTCDay() + 6) % 7) * 86400000;
    if (/M$/.test(r)) day = Date.parse(date.slice(0, 7) + "-01T00:00:00Z");
    return day;
  }

  bridge.tick.connect((sym, bid, ask, tsMs, mid) => {
    const anchor = anchorFor(sym);
    const tsSec = Math.floor(tsMs / 1000);
    // No candle grows in a closed session (the feed is frozen then; this
    // guards against a stray tick).
    if (isClosedSession(tsSec, anchor)) return;
    // The raw feed mid, the same basis as history. Older servers send no mid;
    // then the midpoint of the quote is the closest thing available.
    const price = mid > 0 ? mid : (bid + ask) / 2;
    if (!(price > 0)) return;

    for (const guid in subs) {
      const s = subs[guid];
      if (s.symbol !== sym) continue;
      const bucket = bucketMs(tsSec, s.res, s.resSec, anchor);
      if (!s.lastBar) {
        const h = lastHistBar[sym + "|" + s.res];
        if (h && h.time === bucket) s.lastBar = Object.assign({}, h);
      }
      if (!s.lastBar || bucket > s.lastBar.time) {
        s.lastBar = { time: bucket, open: price, high: price, low: price, close: price, volume: 0 };
      } else if (bucket === s.lastBar.time) {
        s.lastBar.close = price;
        if (price > s.lastBar.high) s.lastBar.high = price;
        if (price < s.lastBar.low)  s.lastBar.low  = price;
      } else {
        continue;   // an out-of-order tick for a bar already closed
      }
      s.onTick(Object.assign({}, s.lastBar));
    }
  });

  return {
    onReady(cb) {
      setTimeout(() => cb({
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
      }), 0);
    },

    searchSymbols(userInput, exchange, symbolType, onResult) {
      const q = (userInput || "").toUpperCase();
      const res = Object.values(symbolsMeta)
        .filter(s => s.symbol.toUpperCase().includes(q))
        .map(s => ({
          symbol: s.symbol, full_name: s.symbol, description: s.display_name || s.symbol,
          exchange: "Vxness", ticker: s.symbol, type: s.category || "forex",
        }));
      onResult(res);
    },

    resolveSymbol(symbolName, onResolve, onError) {
      const meta = symbolsMeta[symbolName] || { symbol: symbolName, digits: 5 };
      const pricescale = Math.pow(10, meta.digits != null ? meta.digits : 5);
      setTimeout(() => onResolve({
        name: symbolName,
        ticker: symbolName,
        description: meta.display_name || symbolName,
        type: meta.category || "forex",
        session: "24x7",
        timezone: "Etc/UTC",
        exchange: "Vxness",
        listed_exchange: "Vxness",
        format: "price",
        minmov: 1,
        pricescale: pricescale,
        has_intraday: true,
        // W/M are aggregated by TradingView from the daily bars, and the
        // in-between intraday steps from the base multipliers below.
        has_weekly_and_monthly: false,
        intraday_multipliers: INTRADAY_MULTIPLIERS,
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        volume_precision: 2,
        data_status: "streaming",
      }), 0);
    },

    getBars(symbolInfo, resolution, periodParams, onResult, onError) {
      const reqId = "r" + (++reqSeq);
      pendingBars[reqId] = { onResult, onError, from: periodParams.from, to: periodParams.to,
                             resSec: resolutionToSec(resolution), res: resolution,
                             symbol: symbolInfo.name };
      const tf = resToTf(resolution);
      bridge.requestBars(symbolInfo.name, tf, periodParams.from, periodParams.to, reqId);

      // Safety net: if the backend never answers (e.g. an expired token 401s
      // the /bars call so barsReady never fires), end the request honestly as
      // "no data" rather than hanging the spinner — never with fake candles.
      pendingBars[reqId].timer = setTimeout(() => {
        const req = pendingBars[reqId];
        if (!req) return;
        delete pendingBars[reqId];
        req.onResult([], { noData: true });
      }, 6000);
    },

    subscribeBars(symbolInfo, resolution, onTick, guid, onResetCacheNeededCallback) {
      subs[guid] = { symbol: symbolInfo.name, res: String(resolution),
                     resSec: resolutionToSec(resolution), onTick, lastBar: null };
      // Kept so a late spread can force a re-fetch of MID-basis history.
      if (typeof onResetCacheNeededCallback === "function")
        resetCbs[guid] = onResetCacheNeededCallback;
    },

    unsubscribeBars(guid) {
      delete subs[guid];
      delete resetCbs[guid];
    },
  };
}

window.makeDatafeed = makeDatafeed;
