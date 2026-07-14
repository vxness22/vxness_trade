# TradingView Charting Library — place files here

The licensed **TradingView Advanced Charting Library** distribution files are
**not committed** to this repo (licensed vendor code + large binaries). They are
placed here on the server / by CI at deploy time.

Drop the library distribution into this folder so it looks like:

```
frontend/public/charting_library/
├── charting_library.standalone.js
├── charting_library.esm.js
├── charting_library.js
├── charting_library.d.ts
├── datafeed-api.d.ts
├── package.json
└── bundles/                      # the library's chunk bundles
```

The app loads it from `/charting_library/charting_library.standalone.js` (see
`frontend/src/components/ChartingLibraryChart.jsx`).

## How the chart is wired (custom datafeed → vxness backend)

- **History:** `GET /api/charts/bars?symbol=&resolution=&from=&to=`
  → `backend/routes/charts.js` (Infoway klines via `infowayService.getCandles`)
- **Live candles:** WebSocket `GET /ws/bars`
  → `backend/ws/barHub.js` + `backend/services/barAggregator.js`
  (OHLC built from the tick MID, streamed per tick + 1s heartbeat)
- **Bid/ask ticks (mid→bid shift):** Socket.IO `priceStream`
  → `frontend/src/services/priceStream.js`

Datafeed: `frontend/src/services/chartingDatafeed.js`
Live bar socket client: `frontend/src/services/barSocket.js`

> **Production note:** Nginx must proxy `/ws/bars` to the backend with the
> WebSocket `Upgrade` headers (same as `/socket.io`).
