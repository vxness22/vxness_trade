import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { Screen, Card, PillButton, IconButton, SegmentedTabs, showToast } from '../../../components/vx';
import { vx, space, sizes, weights, fontFamily, radius } from '../../../theme/vxTheme';
import { BOTTOM_NAV_PILL_HEIGHT } from '../../../components/vx/BottomNavPill';
import ApiService from '../../../services/api/ApiService';
import LocalBankingPanel from '../components/LocalBankingPanel';

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

// USD is always offered, whether or not the admin has added any other currency.
// It is not a row in the Currency collection — the collection holds the
// alternatives — so the list is built with this in front of whatever comes back.
const USD = { currency: 'USD', symbol: '$', rate_to_usd: 1, markup: 0 };

// Deposit — the same flow the website's "Deposit Funds" dialog runs.
//
// This screen used to ask only for an amount, a reference and a screenshot, and
// posted them against a single destination read from /wallet/deposit/bank-details.
// The website asks for two more things first: which CURRENCY the money is being
// sent in, and which of the admin's PAYMENT METHODS it is going to. Both already
// existed on the API (/wallet/currencies and /wallet/payment-methods) and
// /wallet/deposit/manual already accepts `currency` and `payment_method` — the
// app simply never sent them, so every mobile deposit was booked as plain USD
// against "Manual" no matter where the user had actually paid.
//
// (A second screen, DepositManual, had a partial version of this. It was
// registered in FundsStack but nothing ever navigated to it, so no user could
// reach it. The logic belongs here, on the screen the Deposit button opens.)
export default function DepositScreen() {
  const nav = useNavigation();
  const [amount, setAmount] = useState('');
  const [section, setSection] = useState('deposit');

  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState(null);
  const [currencies, setCurrencies] = useState([]);
  const [currency, setCurrency] = useState(USD);

  const [txId, setTxId] = useState('');
  const [proof, setProof] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  // Whether the payment-method list failed to LOAD, as opposed to loading fine
  // and being empty. They look identical on screen but mean opposite things:
  // one is a connection this app could not make, the other is a destination the
  // admin has not set up. Telling the user "contact support" when their phone
  // simply could not reach the server sends them down the wrong path.
  const [loadFailed, setLoadFailed] = useState(false);

  const loadDepositOptions = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const [pm, cur] = await Promise.allSettled([
      ApiService.getDepositMethods(),
      ApiService.getDepositCurrencies(),
    ]);

    if (pm.status === 'fulfilled') {
      const ms = Array.isArray(pm.value?.items) ? pm.value.items : [];
      setMethods(ms);
      // Pre-select when there is only one, so the common case is one tap fewer.
      // With several, the user picks — guessing would send money to the wrong
      // account with no visible sign it had been chosen for them.
      setMethod((cur2) => cur2 || (ms.length === 1 ? ms[0] : null));
    } else {
      setMethods([]);
      setLoadFailed(true);
    }

    if (cur.status === 'fulfilled') {
      setCurrencies(Array.isArray(cur.value?.items) ? cur.value.items : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadDepositOptions(); }, [loadDepositOptions]);

  const currencyOptions = useMemo(
    () => [USD, ...currencies.filter((c) => String(c.currency).toUpperCase() !== 'USD')],
    [currencies],
  );

  const isUsd = String(currency?.currency || 'USD').toUpperCase() === 'USD';

  // What the user will actually be credited, shown so they can check the
  // conversion before paying — the same working the website prints.
  //
  // A PREVIEW only. /wallet/deposit/manual converts again from its own currency
  // row and ignores any rate the client sends, because a rate that arrived with
  // the screen is not one a deposit may be priced at.
  const usdPreview = useMemo(() => {
    const n = Number(amount);
    if (!(n > 0) || isUsd) return null;
    const eff = Number(currency.rate_to_usd) * (1 + Number(currency.markup || 0) / 100);
    return eff > 0 ? n / eff : null;
  }, [amount, currency, isUsd]);

  const effectiveRate = useMemo(() => {
    if (isUsd) return null;
    const eff = Number(currency.rate_to_usd) * (1 + Number(currency.markup || 0) / 100);
    return eff > 0 ? eff : null;
  }, [currency, isUsd]);

  // Why the submit button cannot be pressed yet, or null when it can. Ordered
  // the way the form reads, so the message points at the next thing to do.
  const blockedReason = useMemo(() => {
    // Disabled while still loading — it used to return null here, which left
    // the button pressable before the form knew what it was validating.
    if (loading) return 'Loading payment methods…';
    if (loadFailed) {
      return 'Could not load payment methods — check your connection and pull to retry.';
    }
    if (methods.length === 0) {
      return 'Deposits are not available right now — no payment method has been set up. Please contact support.';
    }
    if (!(Number(amount) > 0)) return 'Enter the amount you are depositing.';
    if (!method) return 'Choose the payment method you paid to.';
    if (!proof) return 'Attach a screenshot of your payment.';
    return null;
  }, [loading, loadFailed, methods.length, amount, method, proof]);

  const copy = useCallback(async (value, what) => {
    await Clipboard.setStringAsync(String(value));
    showToast({ kind: 'success', message: `${what} copied` });
  }, []);

  const pickProof = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showToast({ kind: 'warn', message: 'Permission required to pick image' }); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled && res.assets?.[0]) setProof(res.assets[0]);
  }, []);

  const submit = useCallback(async () => {
    if (!(Number(amount) > 0)) { showToast({ kind: 'warn', message: 'Enter a valid amount' }); return; }
    if (!method) { showToast({ kind: 'warn', message: 'Choose where you paid' }); return; }
    // The screenshot is required by the server, so it is required here too —
    // better a warning now than a rejected submit after filling the form.
    if (!proof) { showToast({ kind: 'warn', message: 'Upload a screenshot of your payment' }); return; }
    // The server caps uploads at 10 MB; say so here rather than after the whole
    // file has been sent and rejected.
    if (Number(proof.fileSize) > 10 * 1024 * 1024) {
      showToast({ kind: 'warn', message: 'That image is over 10 MB — choose a smaller one' });
      return;
    }

    setSubmitting(true);

    try {
      // One file plus plain fields, uploaded natively — see ApiService.uploadFile
      // for why this does not go through FormData.
      const res = await ApiService.uploadFile('/wallet/deposit/manual', {
        file: proof,
        fields: {
          local_amount: amount,
          amount,                                   // older builds read this name
          currency: currency?.currency || 'USD',
          payment_method: method.type || 'Manual',
          // Optional, as on the website — plenty of rails give the payer no
          // reference to quote, and the screenshot is the proof that matters.
          transaction_id: txId.trim(),
        },
      });
      const credited = Number(res?.amount);
      showToast({
        kind: 'success',
        message: Number.isFinite(credited)
          ? `Deposit of $${credited.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} submitted — pending approval`
          : 'Deposit submitted — pending approval',
      });
      setAmount(''); setTxId(''); setProof(null);
    } catch (e) {
      showToast({ kind: 'error', message: e?.message || 'Deposit failed' });
    } finally {
      setSubmitting(false);
    }
  }, [amount, method, currency, txId, proof]);

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <IconButton icon={<Ionicons name="chevron-back" size={22} color={vx.textPrimary} />} accessibilityLabel="Back" onPress={() => nav.goBack()} />
        <Text style={styles.title}>Deposit</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: BOTTOM_NAV_PILL_HEIGHT + space.huge }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: space.lg }}>
          <SegmentedTabs
            value={section}
            onChange={setSection}
            options={[
              { value: 'deposit', label: 'Deposit' },
              { value: 'local_banking', label: 'Local Banking' },
            ]}
          />
        </View>

        {section !== 'deposit' ? (
          <LocalBankingPanel amount={amount} />
        ) : (
          <>
            {/* ── Currency ─────────────────────────────────────────────── */}
            <Text style={styles.label}>Select your currency</Text>
            <View style={styles.grid}>
              {currencyOptions.map((c) => {
                const on = String(currency?.currency) === String(c.currency);
                return (
                  <Pressable
                    key={c.currency}
                    onPress={() => setCurrency(c)}
                    style={[styles.curBtn, on && styles.tileOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.curSym, on && styles.tileTxtOn]}>{c.symbol || c.currency}</Text>
                    <Text style={[styles.curCode, on && styles.tileTxtOn]}>{c.currency}</Text>
                  </Pressable>
                );
              })}
            </View>
            {currencies.length === 0 ? (
              <Text style={styles.hint}>Only USD available. Admin can add more currencies.</Text>
            ) : null}

            {/* ── Amount ───────────────────────────────────────────────── */}
            <Text style={[styles.label, { marginTop: space.lg }]}>
              Amount ({currency?.symbol || '$'} {currency?.currency || 'USD'})
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder={`Enter amount in ${currency?.currency || 'USD'}`}
              placeholderTextColor={vx.textMuted}
              style={styles.amountInput}
            />
            <View style={styles.quickRow}>
              {QUICK_AMOUNTS.map((a) => (
                <Pressable key={a} onPress={() => setAmount(String(a))} style={styles.quickChip} accessibilityRole="button">
                  <Text style={styles.quickTxt}>{currency?.symbol || '$'}{a}</Text>
                </Pressable>
              ))}
            </View>

            {usdPreview != null ? (
              <View style={styles.convertBox}>
                <Text style={styles.convertLab}>You will receive</Text>
                <Text style={styles.convertVal}>${usdPreview.toFixed(2)} USD</Text>
                {effectiveRate != null ? (
                  <Text style={styles.convertRate}>
                    Exchange rate: 1 USD = {currency.symbol}{effectiveRate.toFixed(2)} {currency.currency}
                    {Number(currency.markup) > 0 ? ` (incl. ${currency.markup}% markup)` : ''}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* ── Payment method ───────────────────────────────────────── */}
            <Text style={[styles.label, { marginTop: space.lg }]}>Payment method</Text>
            {loading ? (
              <Text style={styles.empty}>Loading payment methods…</Text>
            ) : methods.length === 0 ? (
              <Pressable onPress={loadDepositOptions} style={styles.emptyBtn} accessibilityRole="button">
                <Text style={styles.empty}>
                  {loadFailed ? 'Could not load payment methods' : 'No payment methods available'}
                </Text>
                {loadFailed ? <Text style={styles.emptyRetry}>Tap to retry</Text> : null}
              </Pressable>
            ) : (
              <View style={styles.grid}>
                {methods.map((m) => {
                  const on = method?.id === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setMethod(m)}
                      style={[styles.methodBtn, on && styles.tileOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Ionicons name={methodIcon(m.type)} size={22} color={on ? vx.accent : vx.textSecondary} />
                      <Text style={[styles.methodTxt, on && styles.tileTxtOn]} numberOfLines={1}>
                        {m.type || 'Manual'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Where the money actually goes. Shown only once a method is
                picked, so the user is never looking at details for an account
                they have not selected. */}
            {method ? (
              <Card style={styles.payCard}>
                <Text style={styles.payTitle}>Pay to</Text>
                {method.qr_code_url ? (
                  <Image source={{ uri: method.qr_code_url }} style={styles.adminQr} resizeMode="contain" />
                ) : null}
                {method.bank_name ? <Detail label="Bank" value={method.bank_name} onCopy={copy} /> : null}
                {method.account_holder_name ? <Detail label="Holder" value={method.account_holder_name} onCopy={copy} /> : null}
                {method.account_number ? <Detail label="A/C" value={method.account_number} onCopy={copy} /> : null}
                {method.ifsc_code ? <Detail label="IFSC" value={method.ifsc_code} onCopy={copy} /> : null}
                {method.upi_id ? <Detail label="UPI" value={method.upi_id} onCopy={copy} /> : null}

                {method.wallet_address ? (
                  <View style={styles.walletBox}>
                    <Text style={styles.walletLab}>Crypto address</Text>
                    <View style={styles.walletRow}>
                      <View style={styles.qrChip}>
                        <QRCode value={method.wallet_address} size={92} backgroundColor="#FFFFFF" color="#000000" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.walletAddr} selectable>{method.wallet_address}</Text>
                        <Pressable onPress={() => copy(method.wallet_address, 'Address')} hitSlop={6}>
                          <Text style={styles.copyTxt}>Copy address</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ) : null}
                <Text style={styles.hint}>Pay to the details above, then attach the screenshot below.</Text>
              </Card>
            ) : null}

            {/* ── Reference + proof ────────────────────────────────────── */}
            <Text style={[styles.label, { marginTop: space.lg }]}>Transaction reference (optional)</Text>
            <TextInput
              value={txId}
              onChangeText={setTxId}
              placeholder="Enter transaction ID or reference"
              placeholderTextColor={vx.textMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.label, { marginTop: space.lg }]}>Payment screenshot (proof)</Text>
            <Pressable onPress={pickProof} style={styles.proofBtn} accessibilityRole="button" accessibilityLabel="Upload payment screenshot">
              {proof ? (
                <Image source={{ uri: proof.uri }} style={styles.proofImg} resizeMode="cover" />
              ) : (
                <View style={styles.proofPlaceholder}>
                  <Ionicons name="cloud-upload-outline" size={28} color={vx.textMuted} />
                  <Text style={styles.proofTxt}>Tap to upload payment screenshot</Text>
                  <Text style={styles.proofSub}>PNG or JPG</Text>
                </View>
              )}
            </Pressable>
            {proof ? (
              <Pressable onPress={() => setProof(null)} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: space.xs }}>
                <Text style={styles.removeTxt}>Remove screenshot</Text>
              </Pressable>
            ) : null}

            {/* A disabled button with no explanation is the worst of both: the
                user cannot proceed and cannot tell why. Say which step is still
                outstanding — and when the admin has configured no destination at
                all, say that plainly rather than leaving a dead control on a
                form the user has just filled in. */}
            {blockedReason ? (
              <View style={styles.blockedBox}>
                <Ionicons name="information-circle-outline" size={16} color={vx.textSecondary} />
                <Text style={styles.blockedTxt}>{blockedReason}</Text>
              </View>
            ) : null}

            <PillButton
              label={submitting ? 'Submitting…' : 'Submit deposit'}
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={submitting || !!blockedReason}
              onPress={submit}
              style={{ marginTop: space.md }}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// Admin sets the method's type as free text ("Bank Transfer", "UPI", "QR Code",
// "Crypto"…), so match loosely and fall back to a neutral card icon.
function methodIcon(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('upi')) return 'phone-portrait-outline';
  if (t.includes('qr')) return 'qr-code-outline';
  if (t.includes('crypto') || t.includes('usdt') || t.includes('wallet')) return 'logo-bitcoin';
  if (t.includes('bank')) return 'business-outline';
  return 'card-outline';
}

function Detail({ label, value, onCopy }) {
  return (
    <Pressable style={styles.detailRow} onPress={() => onCopy?.(value, label)} accessibilityRole="button" accessibilityLabel={`Copy ${label}`}>
      <Text style={styles.detailLab}>{label}</Text>
      <Text style={styles.detailVal} selectable>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs },
  title: { flex: 1, color: vx.textPrimary, fontFamily, fontSize: sizes.h2, fontWeight: weights.heavy, textAlign: 'center' },
  label: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, marginBottom: space.sm },
  hint: { color: vx.textMuted, fontFamily, fontSize: sizes.micro, lineHeight: 15, marginTop: space.xs },
  empty: { color: vx.textMuted, fontFamily, fontSize: sizes.label, textAlign: 'center', paddingVertical: space.lg },
  emptyBtn: { alignItems: 'center' },
  emptyRetry: { color: vx.accent, fontFamily, fontSize: sizes.label, fontWeight: weights.bold, marginTop: -space.md, paddingBottom: space.md },
  blockedBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    marginTop: space.lg, padding: space.md,
    backgroundColor: vx.bgElevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: vx.border,
  },
  blockedTxt: { flex: 1, color: vx.textSecondary, fontFamily, fontSize: sizes.label, lineHeight: 18 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tileOn: { borderColor: vx.accent, backgroundColor: vx.accent + '18' },
  tileTxtOn: { color: vx.accent },

  curBtn: {
    minWidth: 62, alignItems: 'center', gap: 2,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    backgroundColor: vx.bgElevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: vx.border,
  },
  curSym: { color: vx.textPrimary, fontFamily, fontSize: sizes.body, fontWeight: weights.heavy },
  curCode: { color: vx.textSecondary, fontFamily, fontSize: sizes.micro, fontWeight: weights.bold },

  methodBtn: {
    minWidth: 104, flexGrow: 1, alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.md, paddingVertical: space.md,
    backgroundColor: vx.bgElevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: vx.border,
  },
  methodTxt: { color: vx.textPrimary, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },

  amountInput: {
    backgroundColor: vx.bgElevated, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.lg,
    color: vx.textPrimary, fontFamily, fontSize: sizes.h1, fontWeight: weights.heavy,
  },
  quickRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
  quickChip: { paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: vx.bgRaised, borderRadius: radius.pill },
  quickTxt: { color: vx.textPrimary, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },
  input: { backgroundColor: vx.bgElevated, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, color: vx.textPrimary, fontFamily, fontSize: sizes.body },

  convertBox: {
    marginTop: space.md, padding: space.md, borderRadius: radius.md,
    backgroundColor: vx.accent + '14', borderWidth: 1, borderColor: vx.accent + '3A',
    alignItems: 'center', gap: 2,
  },
  convertLab: { color: vx.textMuted, fontFamily, fontSize: sizes.micro },
  convertVal: { color: vx.accent, fontFamily, fontSize: sizes.h2, fontWeight: weights.heavy },
  convertRate: { color: vx.textMuted, fontFamily, fontSize: sizes.micro, marginTop: space.xs, textAlign: 'center' },

  payCard: { gap: space.xs, marginTop: space.md },
  payTitle: { color: vx.textMuted, fontFamily, fontSize: sizes.micro, fontWeight: weights.bold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: space.xs },
  adminQr: { width: 150, height: 150, borderRadius: radius.md, backgroundColor: '#FFFFFF', marginBottom: space.sm, alignSelf: 'center' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: space.md },
  detailLab: { color: vx.textMuted, fontFamily, fontSize: sizes.label },
  detailVal: { color: vx.textPrimary, fontFamily, fontSize: sizes.label, fontWeight: weights.bold, flexShrink: 1, textAlign: 'right' },
  walletBox: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: vx.border, gap: space.sm },
  walletLab: { color: vx.textMuted, fontFamily, fontSize: sizes.micro, fontWeight: weights.bold, letterSpacing: 1, textTransform: 'uppercase' },
  walletRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  qrChip: { padding: space.xs, backgroundColor: '#FFFFFF', borderRadius: 8 },
  walletAddr: { color: vx.textPrimary, fontFamily, fontSize: sizes.label, fontWeight: weights.semibold },
  copyTxt: { color: vx.accent, fontFamily, fontSize: sizes.label, fontWeight: weights.bold, marginTop: space.xs },

  proofBtn: { backgroundColor: vx.bgElevated, borderRadius: radius.md, overflow: 'hidden', minHeight: 140, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: vx.border, borderStyle: 'dashed' },
  proofImg: { width: '100%', height: 200 },
  proofPlaceholder: { alignItems: 'center', padding: space.lg, gap: space.xs },
  proofTxt: { color: vx.textMuted, fontFamily, fontSize: sizes.label },
  proofSub: { color: vx.textMuted, fontFamily, fontSize: sizes.micro },
  removeTxt: { color: vx.down, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },
});
