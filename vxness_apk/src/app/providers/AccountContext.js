import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';
import ApiService from '../../services/api/ApiService';

// Global trading-account selection so picking an account anywhere (Home, Trade,
// an instrument detail screen) syncs everywhere. Persisted so it survives
// restarts.
const AccountContext = createContext(null);
// Exported so logout can clear it. Left behind, the previous user's account id
// is the first thing the next sign-in on this device tries to restore.
export const SELECTED_ACCOUNT_KEY = 'selectedAccountId';
const KEY = SELECTED_ACCOUNT_KEY;

// account_id is what /api/v1/accounts calls it; without it the switcher had no
// identity to match a saved selection against.
const idOf = (a) => (a ? String(a.id || a._id || a.account_id || '') : '');

// Which account to land on when nothing was saved on this device.
//
// This used to be `list.find((a) => a.is_active)`, and /accounts did not send
// an `is_active` field at all — so the lookup always missed and the app fell
// through to list[0]. That list arrives newest-first and includes demos, so a
// trader who opened a demo last week placed every order from the app on the
// demo while the web terminal showed their live account, and reported that
// trades made on the phone never appeared.
//
// Preference: the OLDEST active live account, then the oldest active one, then
// whatever exists.
//
// Oldest, not first-in-list, and the difference is the whole bug. /accounts
// sorts newest-first for display, so `list[0]` is the account the trader opened
// most recently. The account created at signup — the one they have always
// traded, the one the web terminal is open on — sits at the END of that list.
// A trader with two live accounts placed orders from the app on the new empty
// one while watching the old one on the web, and reported that app trades never
// showed up.
//
// created_at drives the ordering; if an older backend omits it, the list order
// is reversed as a stand-in, which gives the same answer for that sort.
const isActive = (a) => a?.is_active === true || String(a?.status || '') === 'Active';
const isDemo = (a) => a?.is_demo === true || a?.isDemo === true;

function oldestFirst(list) {
  const withTime = list.map((a, i) => {
    const t = Date.parse(a?.created_at || a?.createdAt || '');
    // No timestamp: fall back to reversed list order (newest-first → oldest-first).
    return { a, t: Number.isFinite(t) ? t : (list.length - i) };
  });
  return withTime.sort((x, y) => x.t - y.t).map((e) => e.a);
}

function defaultAccount(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const byAge = oldestFirst(list);
  return (
    byAge.find((a) => isActive(a) && !isDemo(a)) ||
    byAge.find((a) => isActive(a)) ||
    byAge.find((a) => !isDemo(a)) ||
    byAge[0] ||
    null
  );
}

export function AccountProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await ApiService.getAccounts();
      const list = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
      setAccounts(list);
      // Keep the current selection pointed at the freshest row.
      setSelectedAccount((cur) => (cur ? (list.find((a) => idOf(a) === idOf(cur)) || cur) : cur));
      return list;
    } catch (_) {
      return [];
    }
  }, []);

  // Initial load + restore the saved selection (or default to active/first).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await refreshAccounts();
      if (cancelled) return;
      let savedId = null;
      try { savedId = await SecureStore.getItemAsync(KEY); } catch (_) {}
      setSelectedAccount((cur) => {
        if (cur) return cur;
        const saved = savedId ? list.find((a) => idOf(a) === String(savedId)) : null;
        return saved || defaultAccount(list);
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshAccounts]);

  const selectAccount = useCallback((acc) => {
    setSelectedAccount(acc);
    const id = idOf(acc);
    if (id) SecureStore.setItemAsync(KEY, id).catch(() => {});
  }, []);

  // Memoized so consumers only re-render when the underlying data changes,
  // not on every provider render (the callbacks above are already stable).
  const value = useMemo(
    () => ({ accounts, selectedAccount, selectAccount, refreshAccounts, loading }),
    [accounts, selectedAccount, selectAccount, refreshAccounts, loading],
  );

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext) || {
    accounts: [], selectedAccount: null, selectAccount: () => {}, refreshAccounts: async () => {}, loading: false,
  };
}
