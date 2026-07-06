# TradingView Charting Library

Place the licensed TradingView Charting Library distribution into this folder so the chart container
(`frontend/src/components/TradingViewChart.jsx`) can load it.

## What goes here

Copy the **contents** of the `charting_library/` folder from your approved TradingView distribution
(the one you received in their private GitHub repo) into this directory.

After copying, this folder should look something like:

```
frontend/public/charting_library/
├── charting_library.js          ← loaded at runtime by TradingViewChart.jsx
├── charting_library.esm.js
├── charting_library.d.ts
├── bundles/
│   ├── ...
└── (other distribution files)
```

The component fetches `/charting_library/charting_library.js` and instantiates `window.TradingView.widget`
with our custom datafeed (`frontend/src/services/chartDatafeed.js`).

## How to verify

1. Drop the library files in this folder
2. Restart the Vite dev server (`npm run dev` in `frontend/`)
3. Open the trading page → chart should load with **broker-aligned candles**
   (same price as the order panel — both from MetaApi)
4. Network tab should show requests to:
   - `/charting_library/charting_library.js` (200 OK)
   - `/api/charts/config`, `/api/charts/symbols`, `/api/charts/history` (200 OK)

## If the chart shows "Failed to load charting_library.js"

The library files are missing or paths are wrong. Confirm `frontend/public/charting_library/charting_library.js`
exists on disk (case-sensitive on Linux servers).

## Don't commit the library to git

TradingView's license forbids redistributing the library. Add to `.gitignore`:

```
frontend/public/charting_library/
```

(Keep this README in git as a placeholder — `!frontend/public/charting_library/PLACE_LIBRARY_FILES_HERE.md`)
