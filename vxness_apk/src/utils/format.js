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
