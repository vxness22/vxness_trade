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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pm, cur] = await Promise.all([
        ApiService.getDepositMethods().catch(() => ({ items: [] })),
        ApiService.getDepositCurrencies().catch(() => ({ items: [] })),
      ]);
      if (cancelled) return;
      const ms = Array.isArray(pm?.items) ? pm.items : [];
      setMethods(ms);
      // Pre-select when there is only one, so the common case is one tap fewer.
      // With several, the user picks — guessing would send money to the wrong
      // account with no visible sign it had been chosen for them.
      setMethod(ms.length === 1 ? ms[0] : null);
      setCurrencies(Array.isArray(cur?.items) ? cur.items : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

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

  const copy = useCallback(async (value, what) => {
    await Clipboard.setStringAsync(String(value));
    showToast({ kind: 'success', message: `${what} copied` });
  }, []);

  const pickProof = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showToast({ kind: 'warn', message: 'Permission required to pick image' }); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!res.canceled && res.assets?.[0]) setProof(res.assets[0]);
  }, []);

  const submit = useCallback(async () => {
    if (!(Number(amount) > 0)) { showToast({ kind: 'warn', message: 'Enter a valid amount' }); return; }
    if (!method) { showToast({ kind: 'warn', message: 'Choose where you paid' }); return; }
    // The screenshot is required by the server, so it is required here too —
    // better a warning now than a rejected submit after filling the form.
    if (!proof) { showToast({ kind: 'warn', message: 'Upload a screenshot of your payment' }); return; }

    setSubmitting(true);
    const fd = new FormData();
    fd.append('local_amount', String(amount));
    fd.append('amount', String(amount));          // older builds of the API read this name
    fd.append('currency', currency?.currency || 'USD');
    fd.append('payment_method', method.type || 'Manual');
    // Optional, exactly as on the website — plenty of rails give the payer no
    // reference to quote, and the screenshot is the proof that matters.
    fd.append('transaction_id', txId.trim());
    fd.append('file', {
      uri: proof.uri,
      type: proof.mimeType || 'image/jpeg',
      name: proof.fileName || 'proof.jpg',
    });

    try {
      const res = await ApiService.submitManualDeposit(fd);
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
              <Text style={styles.empty}>No payment methods available</Text>
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

            <PillButton
              label={submitting ? 'Submitting…' : 'Submit deposit'}
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={submitting || !(Number(amount) > 0) || !method || !proof}
              onPress={submit}
              style={{ marginTop: space.xl }}
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
