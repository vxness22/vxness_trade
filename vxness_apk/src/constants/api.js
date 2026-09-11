import {
  API_BASE_URL as ENV_API_BASE_URL,
  API_URL as ENV_API_URL,
  WS_URL as ENV_WS_URL,
} from '@env';

const DEFAULT_BASE = 'https://api.vxness.in';

function trimOrEmpty(v) {
  if (v == null || typeof v !== 'string') return '';
  return v.trim();
}

export const API_BASE_URL =
  trimOrEmpty(ENV_API_BASE_URL) || DEFAULT_BASE;

const baseNoSlash = API_BASE_URL.replace(/\/$/, '');

export const API_URL =
  trimOrEmpty(ENV_API_URL) || `${baseNoSlash}/api/v1`;

const derivedWs = API_BASE_URL.startsWith('https')
  ? API_BASE_URL.replace(/^https/, 'wss')
  : API_BASE_URL.replace(/^http/, 'ws');

export const WS_URL = trimOrEmpty(ENV_WS_URL) || derivedWs;

// NOTE: there is deliberately no CHART_URL here any more.
//
// The chart is not fetched from the web terminal and never should be. The
// TradingView Charting Library and the app's own chart page ship INSIDE the
// binary: assets/webchart is copied into android/app/src/main/assets by
// plugins/withWebChart.js at build time, and NativeChart loads it from
// file:///android_asset/webchart/index.html. The WebView makes no network
// calls of its own — the React Native host does every fetch with the user's
// token and feeds the chart over a bridge.
//
// Only Expo Go, which cannot carry 1,900 bundled files, falls back to loading
// that same page over HTTPS, and it takes it from the API host (/app-chart,
// served straight out of vxness_apk/assets/webchart) rather than from the
// trader web app. One copy, no drift, and a change to the web terminal's chart
// cannot affect the app.
//
// A CHART_URL constant pointing at https://trade.vxness.in/app-chart used to
// live here. Nothing imported it — the app had already moved to the bundled
// chart — but leaving it in place made it look like the app still borrowed the
// web terminal's chart, which is exactly the confusion it caused.

// Trader-web origin, used only for brand assets in exported PDFs. Stated
// directly rather than derived from a chart URL, so it is not mistaken for one.
export const TRADE_WEB_URL = 'https://trade.vxness.in';
