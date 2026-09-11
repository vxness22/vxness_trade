import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, RefreshControl, View, StyleSheet } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';

import { Screen, SegmentedTabs } from '../../../components/vx';
import { vx, space } from '../../../theme/vxTheme';
import ApiService from '../../../services/api/ApiService';
import webSocketService from '../../../services/websocket/WebSocketService';
import * as SecureStore from 'expo-secure-store';
import { BOTTOM_NAV_PILL_HEIGHT } from '../../../components/vx/BottomNavPill';

import { useAccount } from '../../../app/providers/AccountContext';
import TradeCFDs from './TradeCFDs';
import TradeCopy from './TradeCopy';

const DEFAULT_SYMBOL = 'EURUSD';

// Closed trades per page. No ceiling on how far back the user can go.
const HISTORY_PER_PAGE = 10;

// Fallback page size for a backend that does not paginate this endpoint.
//
// The deployed server ignores `page` and sends no `total` — it just answers
// with the newest `per_page` rows. Asking it for page 2 returns the SAME rows
// as page 1, so offset paging cannot work against it at all, and with no total
// the blotter has nothing to tell it more history exists. That combination is
// why an account with 71 closed trades showed exactly 10 and offered no way
// forward. One large request is the only thing that server can answer
// completely, so when we detect it, that is what we ask for — and the list then
// pages locally, still ten at a time.
const HISTORY_FULL_FETCH = 500;

export default function TradeScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const [view, setView] = useState('cfds');

  // Global account selection — synced with Home and instrument-detail screens.
  const { accounts, selectedAccount, selectAccount, refreshAccounts } = useAccount();
  const [accountSummary, setAccountSummary] = useState(null);
  const [symbol, setSymbol] = useState(route.params?.symbol || DEFAULT_SYMBOL);
  const [tick, setTick] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(null); // server-reported total closed trades
  const historyPageRef = useRef(1);                       // highest page fetched
  const historyLoadingMoreRef = useRef(false);            // in-flight guard for load-more
  // Does this backend paginate /portfolio/trades? null until the first reply
  // tells us: a `total` in the payload means yes. Everything about how history
  // is loaded hangs off this, so the app works against both the current server
  // and the paginated one without needing them to ship together.
  const historyServerPagedRef = useRef(null);
  const historyHydratedRef = useRef(false);               // legacy full fetch done
  // Bumped when the user scrolls near the bottom of the page. The blotter
  // watches it and reveals / fetches the next 10 closed trades, so history
  // loads by scrolling instead of by hunting for a button.
  const [nearEnd, setNearEnd] = useState(0);
  const nearEndArmedRef = useRef(true);
  const prevPosCountRef = useRef(0);   // detect when an open position closes
  const [refreshing, setRefreshing] = useState(false);

  const accountId = selectedAccount?.id || selectedAccount?._id;

  // Account switch: drop the previous account's data immediately — the fetch
  // below repopulates. Without this, account A's positions/history stay on
  // screen under account B until the network round-trip completes.
  useEffect(() => {
    setPositions([]);
    setOrders([]);
    setHistory([]);
    setHistoryTotal(null);
    historyPageRef.current = 1;
    historyServerPagedRef.current = null;
    historyHydratedRef.current = false;
    setAccountSummary(null);
    prevPosCountRef.current = 0;
  }, [accountId]);

  useEffect(() => {
    if (route.params?.symbol) setSymbol(String(route.params.symbol).toUpperCase());
  }, [route.params?.symbol]);

  // Remember the active symbol so re-entering Trade restores it.
  useEffect(() => { if (symbol) SecureStore.setItemAsync('lastSymbol', symbol).catch(() => {}); }, [symbol]);

  // On entering the Trade tab, default to the last instrument the user opened
  // (in Markets or here) — unless this navigation passed an explicit symbol.
  useFocusEffect(useCallback(() => {
    if (route.params?.symbol) return;
    let cancelled = false;
    SecureStore.getItemAsync('lastSymbol').then((s) => {
      if (!cancelled && s) setSymbol(String(s).toUpperCase());
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [route.params?.symbol]));

  // Honor an explicit sub-tab request (e.g. "Go to Trade" from a symbol always
  // lands on CFDs, even if the Trade tab was last left on Copy).
  useEffect(() => {
    const t = route.params?.tradeView;
    if (t === 'cfds' || t === 'copy') setView(t);
  }, [route.params?.tradeView]);

  // Pre-select the account passed in from elsewhere (e.g. Accounts screen).
  useEffect(() => {
    const wanted = route.params?.selectedAccountId;
    if (!wanted || !accounts.length) return;
    const match = accounts.find((a) => String(a.id || a._id) === String(wanted));
    if (match) selectAccount(match);
  }, [accounts, route.params?.selectedAccountId, selectAccount]);

  const loadAccounts = refreshAccounts;

  const refreshAccountData = useCallback(async () => {
    // Skip account-specific calls for an inactive account (avoids spammy errors).
    if (!accountId || selectedAccount?.is_active === false) return;
    const [summary, pos, ords, hist] = await Promise.allSettled([
      ApiService.getAccountSummary(accountId),
      ApiService.getPositions(accountId, 'open'),
      ApiService.getOrders(accountId, 'pending'),
      ApiService.getTradeHistory(accountId, 1, HISTORY_PER_PAGE),
    ]);
    if (summary.status === 'fulfilled') setAccountSummary(summary.value);
    if (pos.status === 'fulfilled') {
      const list = Array.isArray(pos.value) ? pos.value : (Array.isArray(pos.value?.items) ? pos.value.items : []);
      prevPosCountRef.current = list.length;
      setPositions(list);
    }
    if (ords.status === 'fulfilled') {
      const list = Array.isArray(ords.value) ? ords.value : (Array.isArray(ords.value?.items) ? ords.value.items : []);
      setOrders(list);
    }
    if (hist.status === 'fulfilled') {
      const list = Array.isArray(hist.value) ? hist.value : (Array.isArray(hist.value?.items) ? hist.value.items : []);
      // History = closed trades only.
      //
      // MERGE, never replace. This runs on a six-second timer, and it used to
      // assign the first page straight over `history` — so a trader who had
      // loaded older trades watched those rows disappear moments later, and the
      // list looked permanently stuck at one page. A closed trade is immutable,
      // so all this pass has to do is bring in whatever closed since the last
      // one and leave the rest alone.
      const fresh = list.filter((t) => t.close_time || t.close_price);
      setHistory((prev) => {
        const seen = new Set(prev.map((t) => String(t.id || t._id)));
        const added = fresh.filter((t) => !seen.has(String(t.id || t._id)));
        // Newest first, matching the server's sort.
        return added.length ? [...added, ...prev] : prev;
      });

      // `total` absent means the backend does not paginate. Checked for null
      // explicitly because Number(null) is 0, which would read as a paginated
      // server reporting an empty history and hide every row.
      const rawTotal = hist.value?.total;
      const serverTotal = Number(rawTotal);
      const serverPages = rawTotal != null && Number.isFinite(serverTotal);
      historyServerPagedRef.current = serverPages;

      if (serverPages) {
        // Paginated backend: trust its count, and load older pages on demand.
        setHistoryTotal(serverTotal);
      } else if (!historyHydratedRef.current) {
        // Backend without pagination. It cannot be walked page by page, so pull
        // the whole history once — after that the ten-row poll above is only
        // there to notice newly closed trades.
        historyHydratedRef.current = true;
        ApiService.getTradeHistory(accountId, 1, HISTORY_FULL_FETCH)
          .then((full) => {
            const all = Array.isArray(full) ? full : (Array.isArray(full?.items) ? full.items : []);
            const closed = all.filter((t) => t.close_time || t.close_price);
            if (!closed.length) return;
            setHistory(closed);
            // Everything is loaded, so the loaded count IS the total.
            setHistoryTotal(closed.length);
          })
          .catch(() => { historyHydratedRef.current = false; });
      }
    }
  }, [accountId, selectedAccount]);

  // Fetch the next page of closed trades and append it. No ceiling — the user
  // can keep going until the account runs out of history.
  //
  // Appends and de-dupes by id rather than trusting the offset blindly: a trade
  // closing while the user reads pushes every older row down one place, so the
  // first row of the next page can be one the previous page already showed.
  // Nothing is ever skipped, because closed trades only ever enter at the top.
  const loadMoreHistory = useCallback(async () => {
    if (!accountId || historyLoadingMoreRef.current) return;
    // Nothing to fetch against a backend that does not paginate — the whole
    // history was pulled in one go above, and asking for "page 2" there would
    // just return the first rows again.
    if (historyServerPagedRef.current === false) return;
    historyLoadingMoreRef.current = true;
    try {
      const next = historyPageRef.current + 1;
      const res = await ApiService.getTradeHistory(accountId, next, HISTORY_PER_PAGE);
      const list = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
      if (list.length) {
        historyPageRef.current = next;
        setHistory((prev) => {
          const seen = new Set(prev.map((t) => String(t.id || t._id)));
          const added = list.filter((t) => (t.close_time || t.close_price) && !seen.has(String(t.id || t._id)));
          return added.length ? [...prev, ...added] : prev;
        });
      }
      if (Number.isFinite(Number(res?.total))) setHistoryTotal(Number(res.total));
    } catch (_) {
      /* keep what we have; the user can tap again */
    } finally {
      historyLoadingMoreRef.current = false;
    }
  }, [accountId]);

  const refreshTick = useCallback(async () => {
    if (!symbol) return;
    try {
      const res = await ApiService.getAllPrices();
      const list = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
      const t = list.find((p) => String(p.symbol || p.ticker || '').toUpperCase() === symbol.toUpperCase());
      if (t) setTick(t);
    } catch (_) {}
  }, [symbol]);

  // Light live refresh — account summary + open positions — so P&L / margin
  // keep moving without re-fetching orders/history every tick.
  const refreshLive = useCallback(async () => {
    if (!accountId || selectedAccount?.is_active === false) return;
    const [summary, pos] = await Promise.allSettled([
      ApiService.getAccountSummary(accountId),
      ApiService.getPositions(accountId, 'open'),
    ]);
    if (summary.status === 'fulfilled') setAccountSummary(summary.value);
    if (pos.status === 'fulfilled') {
      const list = Array.isArray(pos.value) ? pos.value : (Array.isArray(pos.value?.items) ? pos.value.items : []);
      // A drop in open positions means one closed (e.g. SL/TP hit) — pull
      // orders + history right away so the closed trade shows immediately
      // instead of waiting for the next focus/full refresh.
      if (list.length < prevPosCountRef.current) refreshAccountData();
      prevPosCountRef.current = list.length;
      setPositions(list);
    }
  }, [accountId, selectedAccount, refreshAccountData]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { refreshAccountData(); }, [refreshAccountData]);
  useEffect(() => { refreshTick(); }, [refreshTick]);

  useFocusEffect(useCallback(() => {
    refreshAccountData();
    refreshTick();
  }, [refreshAccountData, refreshTick]));

  // Poll while focused: price AND P&L / positions every 1s — matching the web
  // terminal's ~1.5s poll so both clients read the same server P&L within a
  // second of each other. Works even if the live WebSocket stalls.
  useFocusEffect(useCallback(() => {
    let n = 0;
    const id = setInterval(() => {
      refreshTick();
      refreshLive();
      if (n % 6 === 5) refreshAccountData();   // periodic full refresh (orders + closed history)
      n += 1;
    }, 1000);
    return () => clearInterval(id);
  }, [refreshTick, refreshLive, refreshAccountData]));

  useEffect(() => {
    if (typeof webSocketService?.onPriceUpdate !== 'function') return;
    const unsubscribe = webSocketService.onPriceUpdate((msg) => {
      if (!msg) return;
      const sym = String(msg.symbol || msg.s || '').toUpperCase();
      if (sym !== symbol.toUpperCase()) return;
      setTick((prev) => ({
        ...(prev || {}),
        symbol: sym,
        bid: msg.bid != null ? Number(msg.bid) : prev?.bid,
        ask: msg.ask != null ? Number(msg.ask) : prev?.ask,
      }));
    });
    webSocketService.connectPriceStream?.();
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [symbol]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([loadAccounts(), refreshAccountData(), refreshTick()]);
    setRefreshing(false);
  }, [loadAccounts, refreshAccountData, refreshTick]);

  return (
    <Screen edges={['top']}>
      <View style={styles.headerWrap}>
        <SegmentedTabs
          value={view}
          onChange={setView}
          options={[
            { value: 'cfds', label: 'CFDs' },
            { value: 'copy', label: 'Copy' },
          ]}
        />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: BOTTOM_NAV_PILL_HEIGHT + space.huge }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={vx.accent} colors={[vx.accent]} />
        }
        keyboardShouldPersistTaps="handled"
        // Infinite scroll for the History tab. Re-arms only after the user
        // scrolls back out of the trigger zone, so one approach to the bottom
        // asks for one page rather than firing on every scroll frame.
        scrollEventThrottle={64}
        onScroll={({ nativeEvent: e }) => {
          const distanceFromEnd =
            e.contentSize.height - (e.layoutMeasurement.height + e.contentOffset.y);
          if (distanceFromEnd < 260) {
            if (nearEndArmedRef.current) {
              nearEndArmedRef.current = false;
              setNearEnd((n) => n + 1);
            }
          } else if (distanceFromEnd > 420) {
            nearEndArmedRef.current = true;
          }
        }}
      >
        {view === 'cfds' ? (
          <TradeCFDs
            accounts={accounts}
            selectedAccount={selectedAccount}
            onSelectAccount={selectAccount}
            symbol={symbol}
            onSelectSymbol={setSymbol}
            tick={tick}
            accountSummary={accountSummary}
            positions={positions}
            orders={orders}
            history={history}
            historyTotal={historyTotal}
            onLoadMoreHistory={loadMoreHistory}
            nearEnd={nearEnd}
            onChange={refreshAccountData}
          />
        ) : (
          <TradeCopy />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: space.lg, paddingTop: space.sm },
  scroll: {},
});
