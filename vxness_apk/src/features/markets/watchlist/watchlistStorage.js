import * as SecureStore from 'expo-secure-store';

const KEY = 'vxness.watchlist';

// Every entry here must be a symbol the platform actually quotes.
//
// 'Nikkei225' was in this list and is not in the catalogue — the instrument is
// JPN225. It was also the only mixed-case entry, and every comparison in the
// app upper-cases first, so it resolved to 'NIKKEI225' and matched nothing. New
// users opened the app to a watchlist row that had no price and never would.
const DEFAULT_WATCHLIST = ['XAUUSD', 'NAS100', 'BTCUSD', 'EURUSD', 'JPN225'];

let cached = null;

// SecureStore is not guaranteed to be there. It is native, and a build where it
// has not been linked throws "Property 'SecureStore' doesn't exist" on the first
// call — which is exactly why services/storage/safeSecureStore.js exists for the
// auth token. The watchlist reads and writes it directly, so it needs the same
// guard.
function storeAvailable() {
  return typeof SecureStore?.getItemAsync === 'function'
    && typeof SecureStore?.setItemAsync === 'function';
}

export async function getWatchlist() {
  if (cached) return cached;
  try {
    if (!storeAvailable()) throw new Error('SecureStore unavailable');
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cached = parsed;
        return parsed;
      }
    }
  } catch (_) {}
  cached = DEFAULT_WATCHLIST;
  return DEFAULT_WATCHLIST;
}

/**
 * Persists the watchlist. Returns true when it was actually written.
 *
 * The failure used to be swallowed whole: `cached` was assigned BEFORE the
 * write and the catch was empty, so a store that rejected the value left the
 * app showing a watchlist it had not saved. The symbol looked added, survived
 * until the app was killed, and was gone on the next launch with nothing ever
 * having reported a problem. The cache is now only updated once the write has
 * succeeded, and the caller is told either way.
 */
export async function setWatchlist(symbols) {
  const list = Array.isArray(symbols)
    ? symbols.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().toUpperCase())
    : [];

  if (!storeAvailable()) {
    // Keep it for this session so the UI still behaves, but say it did not save.
    cached = list;
    return false;
  }

  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(list));
    cached = list;
    return true;
  } catch (e) {
    cached = list;
    return false;
  }
}

// Symbols are compared upper-cased everywhere else in the app, so they are
// stored that way too. Matching on the raw string let the same instrument be
// added twice under different casing.
export async function addToWatchlist(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return getWatchlist();
  const cur = await getWatchlist();
  if (cur.some((s) => String(s).toUpperCase() === sym)) return cur;
  const next = [...cur, sym];
  await setWatchlist(next);
  return next;
}

export async function removeFromWatchlist(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const cur = await getWatchlist();
  const next = cur.filter((s) => String(s).toUpperCase() !== sym);
  await setWatchlist(next);
  return next;
}
