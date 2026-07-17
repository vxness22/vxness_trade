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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_URL } from "../config/api";
import priceStreamService from "../services/priceStream";
import { vxnessDatafeed, setQuoteAdjuster } from "../services/chartingDatafeed";
import logoImage from "../assets/logo.png";

function tvCtor() {
  if (typeof window === "undefined") return undefined;
  return window.TradingView && window.TradingView.widget;
}

// ?v cache-buster — see git history: a CDN cached the SPA index.html fallback for
// this .js path when the library wasn't deployed. Bump on library updates.
const LIB_URL = "/charting_library/charting_library.standalone.js?v=2";

let _libPromise = null;
function loadChartingLibrary() {
  if (typeof window === "undefined") return Promise.resolve();
  if (tvCtor()) return Promise.resolve();
  if (_libPromise) return _libPromise;
  _libPromise = (async () => {
    const res = await fetch(LIB_URL);
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || ct.includes("text/html")) {
      throw new Error(
        "charting_library not found on server (deploy the library files)",
      );
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = LIB_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("charting_library failed to load"));
      document.head.appendChild(s);
    });
    if (!tvCtor()) throw new Error("charting_library did not initialize");
  })().catch((e) => {
    _libPromise = null;
    throw e;
  });
  return _libPromise;
}

const CHART_SAVE_KEY = "vxness_chart_layout_v1";

// Hide the "Vxness" branding logo (bottom-left). It renders as an
// anchor (text "Vxness" / link to tradingview.com); the CSS-module
// classes are hashed, so we hide it by href/text via CSS + a JS sweep.
const CSS_HIDE_TV_LOGO =
  'a[href*="tradingview.com"],[class*="brand-H"],[class*="chartLogo"],#tv-attr-logo,#tv-logo{display:none!important;}';
function injectHideTvLogo(container) {
  try {
    const roots = [];
    if (typeof document !== "undefined") {
      if (!document.getElementById("vx-hide-tv-logo")) {
        const st = document.createElement("style");
        st.id = "vx-hide-tv-logo";
        st.textContent = CSS_HIDE_TV_LOGO;
        document.head.appendChild(st);
      }
      if (container) roots.push(container);
    }
    if (container) {
      container.querySelectorAll("iframe").forEach((f) => {
        try {
          const doc = f.contentDocument;
          if (!doc) return;
          roots.push(doc);
          if (!doc.getElementById("vx-hide-tv-logo")) {
            const st = doc.createElement("style");
            st.id = "vx-hide-tv-logo";
            st.textContent = CSS_HIDE_TV_LOGO;
            (doc.head || doc.documentElement).appendChild(st);
          }
        } catch {
          /* cross-origin */
        }
      });
    }
    // JS sweep: hide the branding logo whatever its tag. Match anchors by href OR
    // text (an SVG <title>TradingView</title> pollutes textContent, so we match
    // "tradingview" anywhere, not an exact string), plus small non-anchor wrappers
    // whose text mentions "by TradingView".
    for (const root of roots) {
      // The branding logo element (identified in the library bundle): a
      // `brand-H…` container with a `chartLogo…` icon — hide by class directly.
      root.querySelectorAll?.('[class*="brand-H"], [class*="chartLogo"]').forEach((el) => {
        el.style.display = "none";
      });
      root.querySelectorAll?.("a").forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (/tradingview/i.test(href) || /tradingview/i.test(a.textContent || "")) {
          a.style.display = "none";
        }
      });
      root.querySelectorAll?.("div,span,button").forEach((el) => {
        if (/by\s*tradingview/i.test(el.textContent || "") && el.children.length <= 2) {
          el.style.display = "none";
          const par = el.parentElement;
          if (par && /by\s*tradingview/i.test(par.textContent || "") && par.children.length <= 3) {
            par.style.display = "none";
          }
        }
      });
    }
  } catch {
    /* noop */
  }
}

const CHART_BUY_COLOR = "#3b82f6";
const CHART_SELL_COLOR = "#ef4444";
const SL_COLOR = "#f59e0b";
const TP_COLOR = "#14b8a6";
const PROFIT_COLOR = "#3b82f6";
const LOSS_COLOR = "#ef4444";
const BREAKEVEN_COLOR = "#9ca3af";
// Where the on-chart button group sits, from the chart's RIGHT edge (clear of the
// right-axis price/label).
const BTN_RIGHT_PX = 210;

const LTP_LINE_OVERRIDES = {
  "mainSeriesProperties.showPriceLine": true,
  "mainSeriesProperties.priceLineWidth": 1,
};

// Instrument digits cache (for price precision on SL/TP labels).
let _digitsMap = {};
fetch(`${API_URL}/prices/instruments`)
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    (d?.instruments || []).forEach((i) => {
      _digitsMap[String(i.symbol).toUpperCase()] = i.digits;
    });
  })
  .catch(() => {});
function digitsFor(sym) {
  const d = _digitsMap[String(sym).toUpperCase()];
  return Number.isFinite(d) ? d : 2;
}

function normalizePosition(p) {
  const id = String(p._id || p.id || p.ticket || "");
  const side =
    String(p.side || p.type || "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const openPrice = Number(p.openPrice ?? p.entryPrice ?? p.price ?? 0);
  const quantity = Number(p.quantity ?? p.lots ?? p.volume ?? 0);
  const contractSize = Number(p.contractSize) || 100;
  const sl = Number(p.sl ?? p.stopLoss ?? 0);
  const tp = Number(p.tp ?? p.takeProfit ?? 0);
  return {
    id,
    symbol: String(p.symbol || "").toUpperCase(),
    side,
    openPrice,
    quantity,
    contractSize,
    sl,
    tp,
  };
}

// Live P&L for a position at a given price (matches the panel's math).
function pnlAt(p, price) {
  const q = p.quantity,
    cs = p.contractSize;
  return p.side === "BUY"
    ? (price - p.openPrice) * q * cs
    : (p.openPrice - price) * q * cs;
}

export default function ChartingLibraryChart({
  symbol = "XAUUSD",
  interval = "5",
  theme = "dark",
  positions = [],
  onRefresh,
  getQuote,
}) {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);
  const widgetRef = useRef(null);
  const linesRef = useRef(new Map());
  const appliedSymbolRef = useRef("");
  // Latest normalized positions, kept fresh for the button sync loop (SL/TP can
  // change without recreating the buttons, so the loop reads live values here).
  const positionsRef = useRef([]);
  positionsRef.current = (positions || []).map(normalizePosition);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState("");

  const symU = String(symbol || "XAUUSD").toUpperCase();

  const openDialog = (d) => {
    setDialogValue(d.input?.defaultValue ?? "");
    setDialog(d);
  };

  // Feed the datafeed the SAME price adjuster the panel/instrument list use, so the
  // chart candle == the SELL price exactly (admin spread applied). Cleared on unmount.
  useEffect(() => {
    setQuoteAdjuster(typeof getQuote === "function" ? getQuote : null);
    return () => setQuoteAdjuster(null);
  }, [getQuote]);

  // Hide the TradingView branding logo once the chart (and its iframe) exist.
  // Retried for ~10s (the logo renders shortly after ready), and re-run on resize
  // because the adaptive logo re-renders then.
  useEffect(() => {
    if (!ready) return;
    const c = containerRef.current;
    const run = () => injectHideTvLogo(c);
    run();
    let n = 0;
    const iv = setInterval(() => {
      run();
      if (++n > 30) clearInterval(iv);
    }, 400);
    const onResize = () => {
      run();
      setTimeout(run, 300);
      setTimeout(run, 800);
    };
    window.addEventListener("resize", onResize);
    // Persistent, debounced observer on the chart iframe's document so a
    // re-rendered logo is re-hidden immediately (works now the iframe is
    // same-origin). Debounced because candle ticks mutate the DOM constantly.
    const observers = [];
    let obsTimer = null;
    const debouncedRun = () => {
      if (obsTimer) return;
      obsTimer = setTimeout(() => {
        obsTimer = null;
        run();
      }, 400);
    };
    const attach = () => {
      try {
        c?.querySelectorAll("iframe").forEach((f) => {
          const body = f.contentDocument?.body;
          if (body && !body.__vxLogoObs) {
            body.__vxLogoObs = true;
            const o = new MutationObserver(debouncedRun);
            o.observe(body, { childList: true, subtree: true });
            observers.push(o);
          }
        });
      } catch {
        /* cross-origin */
      }
    };
    attach();
    const attachIv = setInterval(attach, 1000);
    setTimeout(() => clearInterval(attachIv), 15000);
    return () => {
      clearInterval(iv);
      clearInterval(attachIv);
      if (obsTimer) clearTimeout(obsTimer);
      window.removeEventListener("resize", onResize);
      observers.forEach((o) => {
        try {
          o.disconnect();
        } catch {
          /* noop */
        }
      });
    };
  }, [ready]);

  // Swallow the library's benign "Value is null" context-menu rejection.
  useEffect(() => {
    const onRej = (e) => {
      const reason = e.reason;
      const msg =
        typeof reason === "string" ? reason : reason && reason.message;
      const stack = (reason && reason.stack) || "";
      if (msg === "Value is null" && stack.includes("charting_library"))
        e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRej);
    return () => window.removeEventListener("unhandledrejection", onRej);
  }, []);

  // Create the widget once (recreate only on theme change).
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setFailed(false);
    linesRef.current.clear();

    loadChartingLibrary()
      .then(() => {
        const Ctor = tvCtor();
        if (cancelled || !containerRef.current || !Ctor) return;
        try {
          widgetRef.current?.remove?.();
        } catch {
          /* noop */
        }

        let savedData;
        try {
          const s = localStorage.getItem(CHART_SAVE_KEY);
          if (s) savedData = JSON.parse(s);
        } catch {
          /* fresh */
        }

        const themeOverrides =
          theme === "light"
            ? {
                "paneProperties.background": "#ffffff",
                "paneProperties.backgroundType": "solid",
                "paneProperties.vertGridProperties.color": "#ececec",
                "paneProperties.horzGridProperties.color": "#ececec",
                "scalesProperties.textColor": "#131722",
                "scalesProperties.lineColor": "#e0e3eb",
              }
            : {
                "paneProperties.background": "#0c0e12",
                "paneProperties.backgroundType": "solid",
                "paneProperties.vertGridProperties.color": "#1c1f26",
                "paneProperties.horzGridProperties.color": "#1c1f26",
                "scalesProperties.textColor": "#b2b5be",
                "scalesProperties.lineColor": "#2a2e39",
              };

        const w = new Ctor({
          symbol: symU,
          interval: String(interval),
          container: containerRef.current,
          datafeed: vxnessDatafeed,
          library_path: "/charting_library/",
          // Injected INTO the chart's own document — the only reliable way to hide
          // the "Vxness" branding logo (an outside stylesheet can't
          // reach inside the chart). Served from frontend/public/tvchart.css.
          custom_css_url: "/tvchart.css?v=3", // ?v busts Cloudflare's cached copy — bump on edits
          locale: "en",
          theme: theme === "light" ? "Light" : "Dark",
          autosize: true,
          timezone: "Etc/UTC",
          auto_save_delay: 2,
          ...(savedData ? { saved_data: savedData } : {}),
          disabled_features: ["header_symbol_search"],
          // Load the chart iframe from same-origin sameorigin.html so our
          // custom_css_url (loaded with crossorigin="anonymous") and the JS
          // sweep can actually reach inside to hide the TradingView logo — a
          // cross-origin iframe blocks both.
          enabled_features: ["iframe_loading_same_origin"],
          favorites: {
            intervals: [
              "1",
              "3",
              "5",
              "10",
              "15",
              "30",
              "45",
              "60",
              "120",
              "180",
              "240",
              "1D",
              "1W",
              "1M",
            ],
          },
          overrides: {
            "symbolWatermarkProperties.transparency": 84,
            "symbolWatermarkProperties.color":
              theme === "light"
                ? "rgba(40,40,40,0.10)"
                : "rgba(200,200,200,0.10)",
            ...themeOverrides,
            ...LTP_LINE_OVERRIDES,
          },
        });
        widgetRef.current = w;
        appliedSymbolRef.current = symU;
        try {
          w.onChartReady?.(() => {
            if (cancelled) return;
            setReady(true);
            try {
              w.applyOverrides?.(themeOverrides);
            } catch {
              /* noop */
            }
            try {
              w.applyOverrides?.(LTP_LINE_OVERRIDES);
            } catch {
              /* noop */
            }
            try {
              w.subscribe?.("onAutoSaveNeeded", () => {
                try {
                  w.save?.((state) => {
                    try {
                      localStorage.setItem(
                        CHART_SAVE_KEY,
                        JSON.stringify(state),
                      );
                    } catch {
                      /* quota */
                    }
                  });
                } catch {
                  /* noop */
                }
              });
            } catch {
              /* noop */
            }
          });
        } catch {
          /* noop */
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      setReady(false);
      try {
        widgetRef.current?.remove?.();
      } catch {
        /* noop */
      }
      widgetRef.current = null;
      appliedSymbolRef.current = "";
      linesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Change symbol in place.
  useEffect(() => {
    if (!ready) return;
    const w = widgetRef.current;
    if (!w?.activeChart || appliedSymbolRef.current === symU) return;
    try {
      const chart = w.activeChart();
      for (const [, entry] of linesRef.current) {
        try {
          if (entry && entry.id != null) chart.removeEntity(entry.id);
        } catch {
          /* noop */
        }
      }
      linesRef.current.clear();
      chart?.setSymbol?.(symU, () => {});
      appliedSymbolRef.current = symU;
    } catch {
      /* noop */
    }
  }, [symU, ready]);

  // Reconcile entry / SL / TP LINES from positions (display).
  useEffect(() => {
    const w = widgetRef.current;
    if (!ready || !w?.activeChart) return;
    let chart;
    try {
      chart = w.activeChart();
    } catch {
      return;
    }
    if (!chart?.createShape) return;

    const dg = digitsFor(symU);
    const myPos = (positions || [])
      .map(normalizePosition)
      .filter((p) => p.symbol === symU && p.openPrice > 0);
    const pnlColor = (pnl) =>
      Math.abs(pnl) < 0.1
        ? BREAKEVEN_COLOR
        : pnl > 0
          ? PROFIT_COLOR
          : LOSS_COLOR;

    const desired = [];
    for (const p of myPos) {
      const live = priceStreamService.getPrice(p.symbol);
      const cur = live ? (p.side === "BUY" ? live.bid : live.ask) : p.openPrice;
      const pnl = pnlAt(p, cur);
      const sideColor = p.side === "BUY" ? CHART_BUY_COLOR : CHART_SELL_COLOR;
      desired.push({
        key: p.id,
        price: p.openPrice,
        color: sideColor,
        textColor: pnlColor(pnl),
        text: `${p.side} ${p.quantity}  ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`,
        dashed: false,
      });
      if (p.sl > 0)
        desired.push({
          key: `${p.id}-sl`,
          price: p.sl,
          color: SL_COLOR,
          textColor: SL_COLOR,
          text: "", // no on-line text — the left segmented pill carries SL price + P&L
          dashed: true,
        });
      if (p.tp > 0)
        desired.push({
          key: `${p.id}-tp`,
          price: p.tp,
          color: TP_COLOR,
          textColor: TP_COLOR,
          text: "", // no on-line text — the left segmented pill carries TP price + P&L
          dashed: true,
        });
    }

    const shapeOpts = (text, lineColor, textColor, dashed) => ({
      shape: "horizontal_line",
      text,
      lock: true,
      disableSelection: true,
      disableSave: true,
      disableUndo: true,
      overrides: {
        linecolor: lineColor,
        linestyle: dashed ? 2 : 0,
        linewidth: dashed ? 1 : 2,
        // No on-line text label for SL/TP (dashed) — the SL/TP price is shown on
        // the ride-along button + the right-axis price tag (client request).
        // Entry (solid) keeps its P&L label on the right.
        showLabel: !dashed,
        textcolor: textColor,
        fontsize: 11,
        bold: true,
        horzLabelsAlign: "right",
        vertLabelsAlign: "middle",
      },
    });

    const t = Math.floor(Date.now() / 1000);
    const wanted = new Set(desired.map((d) => d.key));
    for (const d of desired) {
      const existing = linesRef.current.get(d.key);
      if (!existing) {
        const entry = {
          id: null,
          price: d.price,
          creating: true,
          text: d.text,
          color: d.color,
          textColor: d.textColor,
        };
        linesRef.current.set(d.key, entry);
        chart
          .createShape(
            { time: t, price: d.price },
            shapeOpts(d.text, d.color, d.textColor, d.dashed),
          )
          .then((id) => {
            if (linesRef.current.get(d.key) === entry) {
              entry.id = id;
              entry.creating = false;
            } else {
              try {
                chart.removeEntity(id);
              } catch {
                /* noop */
              }
            }
          })
          .catch(() => {
            if (linesRef.current.get(d.key) === entry)
              linesRef.current.delete(d.key);
          });
      } else if (existing.id != null) {
        if (existing.price !== d.price) {
          try {
            chart
              .getShapeById(existing.id)
              .setPoints([{ time: t, price: d.price }]);
          } catch {
            /* noop */
          }
          existing.price = d.price;
        }
        if (
          d.text !== existing.text ||
          d.color !== existing.color ||
          d.textColor !== existing.textColor
        ) {
          try {
            chart
              .getShapeById(existing.id)
              .setProperties({
                text: d.text,
                linecolor: d.color,
                textcolor: d.textColor,
              });
          } catch {
            /* noop */
          }
          existing.text = d.text;
          existing.color = d.color;
          existing.textColor = d.textColor;
        }
      }
    }
    for (const [key, entry] of linesRef.current) {
      if (!wanted.has(key)) {
        if (entry && entry.id != null) {
          try {
            chart.removeEntity(entry.id);
          } catch {
            /* noop */
          }
        }
        linesRef.current.delete(key);
      }
    }
  }, [positions, symU, ready]);

  // Stable key of open positions on this symbol — the drag-button overlay rebuilds
  // only when the position SET changes, not every tick.
  const positionsKey = (positions || [])
    .map(normalizePosition)
    .filter((p) => p.symbol === symU)
    .map((p) => `${p.id}:${p.side}:${p.quantity}`)
    .join("|");

  // On-chart drag-to-set SL/TP + close (✕) buttons pinned to each entry line.
  // Ported from SwisDex: this Charting Library build exposes no priceToCoordinate,
  // so we calibrate price→pixel from the chart's OWN crosshair + price scale.
  useEffect(() => {
    const w = widgetRef.current;
    const overlay = overlayRef.current;
    if (!ready || !w?.activeChart || !overlay) return;
    let chart;
    try {
      chart = w.activeChart();
    } catch {
      return;
    }
    if (!chart?.crossHairMoved) return;

    const dg = digitsFor(symU);

    // price ↔ pixel geometry
    const geom = () => {
      try {
        const pane = chart.getPanes?.()[0];
        const ps = pane?.getMainSourcePriceScale?.();
        if (!ps) return null;
        const mode = ps.getMode?.() ?? 0;
        if (mode !== 0 && mode !== 1) return null;
        const range = ps.getVisiblePriceRange?.();
        const h = pane?.getHeight?.() || 0;
        if (!range || !(h > 0) || !(range.to > range.from)) return null;
        if (mode === 1 && !(range.from > 0)) return null;
        return { top: range.to, bottom: range.from, h, log: mode === 1 };
      } catch {
        return null;
      }
    };
    const paneY = (price, g) => {
      if (g.log) {
        if (!(price > 0)) return NaN;
        const lt = Math.log(g.top),
          lb = Math.log(g.bottom);
        return (g.h * (lt - Math.log(price))) / (lt - lb);
      }
      return (g.h * (g.top - price)) / (g.top - g.bottom);
    };
    let calibOffset = null;
    const onCross = (p) => {
      if (!p || typeof p.price !== "number" || typeof p.offsetY !== "number")
        return;
      const g = geom();
      if (!g) return;
      const py = paneY(p.price, g);
      if (Number.isFinite(py)) calibOffset = p.offsetY - py;
    };
    let crossSub = null;
    try {
      crossSub = chart.crossHairMoved();
      crossSub?.subscribe?.(null, onCross);
    } catch {
      /* noop */
    }
    const priceForY = (containerY) => {
      const g = geom();
      if (!g || calibOffset == null) return null;
      const py = containerY - calibOffset;
      if (g.log) {
        const lt = Math.log(g.top),
          lb = Math.log(g.bottom);
        return Math.exp(lt - (py / g.h) * (lt - lb));
      }
      return g.top - (py / g.h) * (g.top - g.bottom);
    };

    // Save an SL/TP bracket — sends BOTH brackets (vxness wipes an omitted one).
    const saveBracket = async (pArg, kind, price) => {
      // Read the LIVE position so the OTHER bracket we re-send isn't a stale value.
      const p = positionsRef.current.find((x) => x.id === pArg.id) || pArg;
      // Restriction: TP must be in the profit direction and SL in the loss
      // direction relative to the entry — else warn and don't save.
      // BUY  → TP above entry, SL below entry.  SELL → TP below entry, SL above.
      if (price != null && price > 0) {
        const entry = Number(p.openPrice) || 0;
        const isBuy = p.side === "BUY";
        let msg = "";
        if (kind === "tp") {
          if (isBuy && price <= entry) msg = "Take Profit must be ABOVE the buy price.";
          else if (!isBuy && price >= entry) msg = "Take Profit must be BELOW the sell price.";
        } else {
          if (isBuy && price >= entry) msg = "Stop Loss must be BELOW the buy price.";
          else if (!isBuy && price <= entry) msg = "Stop Loss must be ABOVE the sell price.";
        }
        if (msg) {
          openDialog({
            title: `Invalid ${kind === "tp" ? "Take Profit" : "Stop Loss"}`,
            body: `${msg} (Entry ${entry})`,
            confirmLabel: "OK",
            onConfirm: () => {},
          });
          onRefresh?.(); // snap the dragged line back to the saved value
          return;
        }
      }
      try {
        const body = {
          tradeId: p.id,
          sl: kind === "sl" ? price : p.sl > 0 ? p.sl : null,
          tp: kind === "tp" ? price : p.tp > 0 ? p.tp : null,
        };
        const res = await fetch(`${API_URL}/trade/modify`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.success === false)
          throw new Error(data.message || "Modify failed");
        onRefresh?.();
      } catch (e) {
        openDialog({
          title: "Error",
          body: (e && e.message) || "Failed to set",
          confirmLabel: "OK",
          onConfirm: () => {},
        });
      }
    };
    const closePos = async (p) => {
      try {
        const t = priceStreamService.getPrice(p.symbol);
        if (!t || !(t.bid > 0) || !(t.ask > 0))
          throw new Error("Price not available");
        const res = await fetch(`${API_URL}/trade/close`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tradeId: p.id, bid: t.bid, ask: t.ask }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.success === false)
          throw new Error(data.message || "Close failed");
        onRefresh?.();
      } catch (e) {
        openDialog({
          title: "Error",
          body: (e && e.message) || "Close failed",
          confirmLabel: "OK",
          onConfirm: () => {},
        });
      }
    };

    const mkBtn = (txt, bg, title, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = txt;
      b.title = title;
      b.style.cssText = `display:flex;align-items:center;justify-content:center;height:18px;min-width:18px;padding:0 ${txt.length > 1 ? "5" : "0"}px;border:0;border-radius:3px;cursor:pointer;font-size:10px;font-weight:700;line-height:1;color:#fff;pointer-events:auto;background:${bg};box-shadow:0 1px 3px rgba(0,0,0,.55);`;
      b.onmouseenter = () => {
        b.style.filter = "brightness(1.15)";
      };
      b.onmouseleave = () => {
        b.style.filter = "none";
      };
      b.onclick = (e) => {
        e.stopPropagation();
        onClick();
      };
      return b;
    };

    // Attach drag-to-set behaviour to any element: press & drag up/down → dashed
    // preview (live price + P&L) → release saves the bracket; a plain click opens
    // a type-a-price dialog. Used on the SL/TP pill's badge + price segments.
    const attachDrag = (el, p, kind) => {
      const color = kind === "sl" ? SL_COLOR : TP_COLOR;
      const zoneBg =
        kind === "sl" ? "rgba(239,68,68,0.13)" : "rgba(20,184,166,0.13)";
      el.style.cursor = "ns-resize";
      el.style.touchAction = "none";
      el.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        const startY = e.clientY;
        let moved = false;
        const zone = document.createElement("div");
        zone.style.cssText = `position:absolute;left:0;right:0;top:0;height:0;background:${zoneBg};pointer-events:none;z-index:6;`;
        const line = document.createElement("div");
        line.style.cssText = `position:absolute;left:0;right:0;top:0;height:0;border-top:1px dashed ${color};pointer-events:none;z-index:7;`;
        const lbl = document.createElement("div");
        lbl.style.cssText = `position:absolute;left:50%;top:0;transform:translate(-50%,-50%);background:${color};color:#fff;font:700 11px system-ui;padding:2px 9px;border-radius:4px;pointer-events:none;z-index:8;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.5);`;
        overlay.appendChild(zone);
        overlay.appendChild(line);
        overlay.appendChild(lbl);
        const entryY = () => {
          const g = geom();
          if (!g || calibOffset == null) return null;
          return paneY(p.openPrice, g) + calibOffset;
        };
        const cleanup = () => {
          for (const x of [zone, line, lbl]) {
            try {
              overlay.removeChild(x);
            } catch {
              /* noop */
            }
          }
        };
        el.onpointermove = (ev) => {
          if (Math.abs(ev.clientY - startY) > 3) moved = true;
          const r = containerRef.current?.getBoundingClientRect();
          if (!r) return;
          const cy = ev.clientY - r.top;
          const price = priceForY(cy);
          line.style.top = `${cy}px`;
          lbl.style.top = `${cy}px`;
          let ptxt = `${kind === "sl" ? "SL" : "TP"} ${price ? price.toFixed(dg) : "—"}`;
          if (price) {
            const pl = pnlAt(p, price);
            ptxt += `  ${pl >= 0 ? "+" : "-"}$${Math.abs(pl).toFixed(2)}`;
          }
          lbl.textContent = ptxt;
          const ey = entryY();
          if (ey != null) {
            zone.style.top = `${Math.min(ey, cy)}px`;
            zone.style.height = `${Math.abs(ey - cy)}px`;
          }
        };
        el.onpointerup = (ev) => {
          el.onpointermove = null;
          el.onpointerup = null;
          try {
            el.releasePointerCapture(ev.pointerId);
          } catch {
            /* noop */
          }
          cleanup();
          if (!moved) {
            const cur = kind === "sl" ? p.sl || "" : p.tp || "";
            openDialog({
              title: `${kind === "sl" ? "Stop Loss" : "Take Profit"} — ${p.side} ${p.quantity} ${symU}`,
              body: "Enter the price. Leave blank to remove.",
              confirmLabel: "Save",
              input: {
                defaultValue: cur ? Number(cur).toFixed(dg) : "",
                placeholder: "Price",
              },
              onConfirm: (raw) => {
                const v = (raw ?? "").trim();
                const val = v === "" ? null : parseFloat(v);
                if (val !== null && !(val > 0)) return;
                saveBracket(p, kind, val);
              },
            });
            return;
          }
          const r = containerRef.current?.getBoundingClientRect();
          const price = r ? priceForY(ev.clientY - r.top) : null;
          if (!price || !(price > 0)) return;
          // Drag release → save immediately (no dialog). Drag again to re-set.
          saveBracket(p, kind, Number(price.toFixed(dg)));
        };
      };
    };

    const myPos = (positions || [])
      .map(normalizePosition)
      .filter((p) => p.symbol === symU && p.openPrice > 0);
    const rows = [];
    // Left-side segmented pill per line, matching the client's reference:
    //   [badge] [price] [P&L] [lots] [✕]
    // Entry pill: side badge (B/S) + entry price + LIVE P&L + lots + close (✕).
    // SL/TP pill: badge + level price + PROJECTED P&L + lots + remove (✕); badge
    // and price are drag handles to move the level. When a bracket isn't set, only
    // its badge shows (a small drag-to-create handle) on the right.
    const darkPill = theme !== "light";
    const LEFT_PX = 54; // clear the left drawing toolbar
    const segBg = darkPill ? "#1b1f27" : "#ffffff";
    const segFg = darkPill ? "#e5e7eb" : "#111827";
    const segDim = darkPill ? "#9ca3af" : "#6b7280";
    const divider = darkPill ? "1px solid rgba(255,255,255,.08)" : "1px solid rgba(0,0,0,.10)";
    const GREEN = "#16a34a";
    const RED = "#dc2626";
    const money = (v) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

    const mkSegPill = () => {
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;left:${LEFT_PX}px;transform:translateY(-50%);display:none;align-items:stretch;height:20px;border-radius:4px;overflow:hidden;pointer-events:auto;z-index:6;font:700 10px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.5);border:1px solid transparent;box-sizing:border-box;`;
      const mkSeg = (extra) => {
        const d = document.createElement("div");
        d.style.cssText = `display:flex;align-items:center;padding:0 6px;white-space:nowrap;${extra || ""}`;
        return d;
      };
      const badge = mkSeg(`background:${segBg};font-weight:800;`);
      const price = mkSeg(`background:${segBg};color:${segFg};border-left:${divider};`);
      const pnl = mkSeg(`background:${segBg};border-left:${divider};`);
      const lots = mkSeg(`background:${segBg};color:${segDim};border-left:${divider};`);
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "✕";
      x.style.cssText = `display:flex;align-items:center;justify-content:center;padding:0 7px;border:0;border-left:${divider};background:${segBg};color:${segDim};cursor:pointer;font:700 10px system-ui;`;
      x.onmouseenter = () => { x.style.color = "#ef4444"; };
      x.onmouseleave = () => { x.style.color = segDim; };
      el.appendChild(badge);
      el.appendChild(price);
      el.appendChild(pnl);
      el.appendChild(lots);
      el.appendChild(x);
      overlay.appendChild(el);
      return { el, badge, price, pnl, lots, x };
    };

    for (const p of myPos) {
      const sideColor = p.side === "BUY" ? GREEN : RED;
      // Entry pill
      const entryPill = mkSegPill();
      entryPill.badge.textContent = p.side === "BUY" ? "B" : "S";
      entryPill.badge.style.color = sideColor;
      entryPill.el.style.borderColor = sideColor;
      entryPill.x.title = `Close ${p.side} ${p.quantity} ${symU}`;
      entryPill.x.onclick = (e) => {
        e.stopPropagation();
        openDialog({
          title: "Close position",
          body: `Close ${p.side} ${p.quantity} ${symU} at market?`,
          confirmLabel: "Close",
          danger: true,
          onConfirm: () => closePos(p),
        });
      };
      // SL pill
      const slPill = mkSegPill();
      slPill.badge.textContent = "SL";
      slPill.badge.style.color = RED;
      slPill.el.style.borderColor = RED;
      attachDrag(slPill.badge, p, "sl");
      attachDrag(slPill.price, p, "sl");
      slPill.x.remove(); // no ✕ icon on SL (client request) — clear it via click-to-type
      // TP pill
      const tpPill = mkSegPill();
      tpPill.badge.textContent = "TP";
      tpPill.badge.style.color = GREEN;
      tpPill.el.style.borderColor = GREEN;
      attachDrag(tpPill.badge, p, "tp");
      attachDrag(tpPill.price, p, "tp");
      tpPill.x.remove(); // no ✕ icon on TP (client request) — clear it via click-to-type

      rows.push({ id: p.id, entryPrice: p.openPrice, entryPill, slPill, tpPill });
    }
    if (rows.length === 0) {
      try {
        crossSub?.unsubscribe?.(null, onCross);
      } catch {
        /* noop */
      }
      return () => {};
    }

    let raf = 0;
    const sync = () => {
      raf = requestAnimationFrame(sync);
      const g = geom();
      if (!g || calibOffset == null) {
        for (const r of rows)
          for (const pill of [r.entryPill, r.slPill, r.tpPill]) pill.el.style.display = "none";
        return;
      }
      const h = containerRef.current?.clientHeight || g.h;
      const live = positionsRef.current;
      const setText = (seg, text) => { if (seg.textContent !== text) seg.textContent = text; };
      const put = (pill, price) => {
        const y = paneY(price, g) + calibOffset;
        if (!(y > 8) || y > h - 8) { pill.el.style.display = "none"; return false; }
        pill.el.style.top = `${y}px`;
        pill.el.style.display = "flex";
        return true;
      };
      for (const r of rows) {
        const lp = live.find((x) => x.id === r.id) || {};
        const lots = String(lp.quantity ?? "");
        // Entry — live P&L off the current market price (bid for buy, ask for sell).
        if (put(r.entryPill, r.entryPrice)) {
          const t = priceStreamService.getPrice(symU);
          const cur = t ? (lp.side === "BUY" ? t.bid : t.ask) : r.entryPrice;
          const pnl = pnlAt(lp, cur);
          setText(r.entryPill.price, Number(lp.openPrice ?? r.entryPrice).toFixed(dg));
          setText(r.entryPill.pnl, money(pnl));
          r.entryPill.pnl.style.color = pnl >= 0 ? GREEN : RED;
          setText(r.entryPill.lots, lots);
        }
        // SL / TP: full pill on its line when set; badge-only drag-to-create
        // handle on the right (at the entry line) when unset.
        const bracket = (pill, kind, val) => {
          const set = val > 0;
          if (!put(pill, set ? val : r.entryPrice)) return;
          if (set) {
            pill.el.style.left = `${LEFT_PX}px`;
            pill.el.style.right = "auto";
            const pl = pnlAt(lp, val);
            setText(pill.price, Number(val).toFixed(dg));
            setText(pill.pnl, money(pl));
            pill.pnl.style.color = pl >= 0 ? GREEN : RED;
            setText(pill.lots, lots);
            pill.price.style.display = "flex";
            pill.pnl.style.display = "flex";
            pill.lots.style.display = "flex";
            pill.x.style.display = "flex";
          } else {
            pill.el.style.left = "auto";
            pill.el.style.right = `${kind === "tp" ? BTN_RIGHT_PX + 34 : BTN_RIGHT_PX + 72}px`;
            pill.price.style.display = "none";
            pill.pnl.style.display = "none";
            pill.lots.style.display = "none";
            pill.x.style.display = "none";
          }
        };
        bracket(r.slPill, "sl", lp.sl);
        bracket(r.tpPill, "tp", lp.tp);
      }
    };
    raf = requestAnimationFrame(sync);

    return () => {
      cancelAnimationFrame(raf);
      try {
        crossSub?.unsubscribe?.(null, onCross);
      } catch {
        /* noop */
      }
      for (const r of rows) {
        for (const pill of [r.entryPill, r.slPill, r.tpPill]) {
          try {
            overlay.removeChild(pill.el);
          } catch {
            /* noop */
          }
        }
      }
    };
  }, [ready, symU, positionsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dark = theme !== "light";
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {/* vxness logo watermark — faint, centered, non-interactive. Sits over the
          chart canvas but under the SL/TP overlay (DOM order). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <img
          src={logoImage}
          alt=""
          aria-hidden
          draggable={false}
          style={{
            width: "38%",
            maxWidth: 300,
            objectFit: "contain",
            opacity: dark ? 0.07 : 0.05,
            userSelect: "none",
          }}
        />
      </div>
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      />
      {/* vxness branding — opaque, positioned over the bottom-left where the
          TradingView logo sits, so it's masked no matter what. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 6,
          bottom: 74,
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 210,
          height: 30,
          padding: "0 10px",
          borderRadius: 6,
          background: dark ? "#0c0e12" : "#ffffff",
          pointerEvents: "none",
          zIndex: 8,
        }}
      >
        <img
          src={logoImage}
          alt=""
          draggable={false}
          style={{ height: 16, width: "auto" }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 0.4,
            color: dark ? "#e5e7eb" : "#111827",
          }}
        >
          vxness
        </span>
      </div>
      {failed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: dark ? "#9ca3af" : "#6b7280",
            fontSize: 14,
            textAlign: "center",
            padding: 16,
          }}
        >
          Chart could not load. The charting library assets may be missing from
          /charting_library/. Please refresh, or contact support.
        </div>
      )}
      {dialog &&
        typeof document !== "undefined" &&
        createPortal(
          <div style={{ position: "fixed", inset: 0, zIndex: 2147483646 }}>
            <div
              onClick={() => setDialog(null)}
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.6)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <div
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  maxWidth: 320,
                  borderRadius: 12,
                  padding: 16,
                  background: dark ? "#15181d" : "#ffffff",
                  border: `1px solid ${dark ? "#2a2e39" : "#e5e7eb"}`,
                  color: dark ? "#e5e7eb" : "#111827",
                  boxShadow: "0 10px 40px rgba(0,0,0,.5)",
                }}
              >
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  {dialog.title}
                </h3>
                <p style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
                  {dialog.body}
                </p>
                {dialog.input && (
                  <input
                    autoFocus
                    type="number"
                    step="any"
                    value={dialogValue}
                    onChange={(e) => setDialogValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const d = dialog;
                        setDialog(null);
                        d.onConfirm(dialogValue);
                      } else if (e.key === "Escape") setDialog(null);
                    }}
                    placeholder={dialog.input.placeholder}
                    style={{
                      width: "100%",
                      marginBottom: 12,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: `1px solid ${dark ? "#2a2e39" : "#d1d5db"}`,
                      background: dark ? "#0c0e12" : "#f9fafb",
                      color: "inherit",
                      fontFamily: "monospace",
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      fontWeight: 700,
                      borderRadius: 8,
                      fontSize: 13,
                      border: 0,
                      cursor: "pointer",
                      background: dark ? "#2a2e39" : "#e5e7eb",
                      color: dark ? "#e5e7eb" : "#111827",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = dialog;
                      setDialog(null);
                      d.onConfirm(dialogValue);
                    }}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      fontWeight: 700,
                      borderRadius: 8,
                      fontSize: 13,
                      border: 0,
                      cursor: "pointer",
                      color: "#fff",
                      background: dialog.danger ? "#ef4444" : "#3b82f6",
                    }}
                  >
                    {dialog.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
