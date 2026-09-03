function pctOf(p) {
  const v = p?.change_pct ?? p?.changePct ?? p?.change_percent ?? null;
  return v == null ? null : Number(v);
}

export function topRisers(pricesMap, n = 5) {
  return Object.values(pricesMap || {})
    .filter((p) => pctOf(p) != null && pctOf(p) > 0)
    .sort((a, b) => pctOf(b) - pctOf(a))
    .slice(0, n);
}

export function topFallers(pricesMap, n = 5) {
  return Object.values(pricesMap || {})
    .filter((p) => pctOf(p) != null && pctOf(p) < 0)
    .sort((a, b) => pctOf(a) - pctOf(b))
    .slice(0, n);
}

// One instrument -> one segment key.
//
// The old alias table listed 'metal' under commodities AND 'commodity' under
// metals, so each of those tabs showed the other's instruments. Matching a
// single key per instrument makes the tabs disjoint, and returning null for
// anything unrecognised keeps a category we don't handle out of every tab
// rather than smearing it across two.
export function segmentKeyOf(inst) {
  const seg = String(inst?.segment || inst?.category || inst?.type || '').toLowerCase();
  if (!seg) return null;
  if (/metal/.test(seg)) return 'metals';            // before commodities: XAUUSD is both, and Metals is the narrower label
  if (/commodit/.test(seg)) return 'commodities';
  if (/crypto|coin/.test(seg)) return 'crypto';
  if (/ind(ex|ices)|idx/.test(seg)) return 'indices';
  if (/forex|fx|currenc/.test(seg)) return 'forex';
  return null;
}

export function bySegment(instruments, segmentKey) {
  if (!segmentKey || segmentKey === 'overview') return instruments;
  return (instruments || []).filter((i) => segmentKeyOf(i) === segmentKey);
}

export const MARQUEE_SPOTLIGHT = ['XAUUSD', 'NAS100', 'BTCUSD'];
