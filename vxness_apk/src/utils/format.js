/**
 * Shared money / percentage / P&L formatting — the single source of truth.
 * Was previously duplicated inline (toLocaleString with 2-digit options) in
 * 11+ files, drifting in style between screens.
 */
import { vx } from '../theme/vxTheme';

/** "1,234.56" — account-currency amount without symbol. */
export function formatMoney(value, { dash = '—' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "+1,234.56" / "−1,234.56" — signed amount (true minus sign). */
export function formatSignedMoney(value, { dash = '—' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "+1.23%" — signed percentage. */
export function formatPct(value, { digits = 2, dash = '—' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/**
 * Price formatted at the instrument's own precision.
 *
 * Every price on the position card and the close sheet used a hardcoded
 * toFixed(5), which is only right for five-digit forex. Gold rendered as
 * 4372.63000, USDJPY as 154.17000 and BTCUSD as 77783.62000 — three trailing
 * digits the instrument does not have and the web terminal never shows.
 *
 * `digits` comes from the server: /instruments carries it per symbol, and it is
 * now on each position, order and quote. 5 stays the fallback so a payload
 * without it renders exactly as before rather than losing precision.
 */
export function formatPriceAt(value, digits, { dash = '—' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  const d = Number(digits);
  return n.toFixed(Number.isFinite(d) && d >= 0 && d <= 8 ? d : 5);
}

/**
 * Spread in POINTS, as the platform counts them.
 *
 * `diff` is the raw ask − bid. Both the order ticket and the instrument screen
 * used to scale it by a fixed 100000 — the five-digit forex assumption applied
 * to everything — so gold's 0.75 spread read as 75000 points instead of 75 and
 * BTC's 0.01 as 1000 instead of 1.
 *
 * `pointSize` is the price value of ONE point and comes from the server
 * (`point_size` on every quote). It is NOT simply 10^-digits: those agree for
 * forex, metals and crypto but not for an index, where one point is a whole
 * index point rather than 0.01 — scaling US30 by its digits would report a
 * 3-point spread as 300. Taking it from the server keeps one definition on both
 * sides instead of the app re-deriving asset classes it does not know about.
 *
 * Falls back to the digits when an older backend sends no point_size, and to
 * five-digit forex when it sends neither.
 */
export function spreadPoints(diff, digitsOrOpts, maybeOpts) {
  const n = Number(diff);
  if (!Number.isFinite(n)) return null;

  const opts = (typeof digitsOrOpts === 'object' && digitsOrOpts !== null) ? digitsOrOpts : (maybeOpts || {});
  const digits = (typeof digitsOrOpts === 'object' || digitsOrOpts == null) ? opts.digits : digitsOrOpts;

  const ps = Number(opts.pointSize);
  if (Number.isFinite(ps) && ps > 0) return Math.round(n / ps);

  const d = Number(digits);
  const scale = Number.isFinite(d) && d >= 0 && d <= 8 ? d : 5;
  return Math.round(n * Math.pow(10, scale));
}

/** Theme color for a P&L value: up-green / down-red / muted for null. */
export function pnlColor(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return vx.textMuted;
  return n >= 0 ? vx.up : vx.down;
}

/**
 * Normalises an expo-image-picker asset into `{ uri, type, name }`.
 *
 * NOT for appending to FormData — Expo's fetch rejects that shape outright (see
 * blobPart below). ApiService.uploadFile consumes this to get a trustworthy
 * mime type and file name for the native uploader.
 *
 * The mime type is the reason this exists. The server accepts jpeg, png, gif,
 * webp and pdf and rejects anything else with "Only images or PDF are
 * accepted". An asset does not always carry a usable `mimeType`: it can be
 * missing entirely on Android, and on an iPhone a photo straight from the
 * camera roll is often HEIC, which is not on that list — so a perfectly normal
 * screenshot was refused with a message that gave the user nothing to act on.
 * The extension decides, and anything unrecognised is sent as jpeg, which is
 * what the picker has already transcoded it to.
 *
 * The file name is made to agree with the type, so the stored file does not end
 * up with an extension that contradicts its contents.
 */
export function filePart(asset, fallbackBase = 'upload') {
  if (!asset?.uri) return null;

  const uri = String(asset.uri);
  const fromName = String(asset.fileName || uri.split('/').pop() || '');
  const ext = (fromName.split('.').pop() || '').toLowerCase();

  const BY_EXT = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf',
  };
  const ACCEPTED = new Set(Object.values(BY_EXT));

  let type = BY_EXT[ext];
  if (!type) {
    const declared = String(asset.mimeType || '').toLowerCase();
    type = ACCEPTED.has(declared) ? declared : 'image/jpeg';
  }

  const EXT_FOR = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'application/pdf': 'pdf',
  };
  const safeExt = EXT_FOR[type] || 'jpg';
  const base = (fromName.replace(/\.[^.]*$/, '') || fallbackBase).replace(/[^A-Za-z0-9_-]/g, '') || fallbackBase;

  return { uri, type, name: `${base}.${safeExt}` };
}

/**
 * Wraps a local file URI in an object that Expo's `fetch` will accept as a
 * multipart part.
 *
 * Expo installs its own WinterCG `fetch` (expo/src/winter/fetch). Its FormData
 * encoder handles a part only when it is a string, a Blob, or an object
 * exposing `bytes()` — and its own source says outright that "`uri` is not
 * supported for React Native's FormData". So the classic React Native file part,
 * `{ uri, name, type }`, falls through to `throw new Error('Unsupported
 * FormDataPart implementation')`. That is the error, and it hits every upload
 * built that way.
 *
 * expo-file-system's `File` implements Blob and provides bytes(), name and
 * type, so appending one of these gives the encoder something it understands.
 *
 * Prefer ApiService.uploadFile for a SINGLE file: it uploads natively and lets
 * the mime type be set explicitly, which matters for HEIC. Use this only where
 * one request has to carry several files, which uploadAsync cannot do.
 */
export function blobPart(asset) {
  if (!asset?.uri) return null;
  try {
    // Required lazily: this module is imported by screens that never upload,
    // and expo-file-system is a native module.
    const { File } = require('expo-file-system');
    return new File(String(asset.uri));
  } catch (e) {
    return null;
  }
}
