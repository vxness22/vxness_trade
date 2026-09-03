import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { Screen, Card, PillButton, IconButton, showToast } from '../../../components/vx';
import { vx, space, sizes, weights, fontFamily, radius } from '../../../theme/vxTheme';
import { BOTTOM_NAV_PILL_HEIGHT } from '../../../components/vx/BottomNavPill';
import ApiService from '../../../services/api/ApiService';

export default function DepositManual() {
  const nav = useNavigation();
  const route = useRoute();
  const initialAmount = route.params?.amount || 0;

  const [bankDetails, setBankDetails] = useState(null);
  const [amount, setAmount] = useState(String(initialAmount || ''));
  const [transactionId, setTransactionId] = useState('');
  const [proof, setProof] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // The website asks where the money is going and in what currency before it
  // will take a deposit. This screen asked for neither.
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState(null);
  const [currencies, setCurrencies] = useState([]);
  const [currency, setCurrency] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [bd, pm, cur] = await Promise.all([
        ApiService.getDepositBankDetails().catch(() => null),
        ApiService.getDepositMethods().catch(() => ({ items: [] })),
        ApiService.getDepositCurrencies().catch(() => ({ items: [] })),
      ]);
      if (cancelled) return;
      if (bd) setBankDetails(bd);
      const ms = Array.isArray(pm?.items) ? pm.items : [];
      setMethods(ms);
      setMethod((c) => c || ms[0] || null);
      const cs = Array.isArray(cur?.items) ? cur.items : [];
      setCurrencies(cs);
      setCurrency((c) => c || cs[0] || null);
    })();
    return () => { cancelled = true; };
  }, []);

  // Shown so the user can check the conversion, exactly as the website does.
  // The SERVER converts again on submit from its own rate — this figure is a
  // preview, never the price.
  const usdPreview = (() => {
    const n = Number(amount);
    if (!(n > 0) || !currency || currency.currency === 'USD') return null;
    const eff = Number(currency.rate_to_usd) * (1 + Number(currency.markup || 0) / 100);
    return eff > 0 ? n / eff : null;
  })();

  const banks = bankDetails?.banks || bankDetails?.bank_accounts || [];
  const upiIds = bankDetails?.upi_ids || bankDetails?.upi || [];

  const pickProof = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showToast({ kind: 'warn', message: 'Permission required to pick image' });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!res.canceled && res.assets?.[0]) setProof(res.assets[0]);
  };

  const submit = async () => {
    if (!proof || !(Number(amount) > 0) || !transactionId.trim()) return;
    setSubmitting(true);
    const fd = new FormData();
    fd.append('local_amount', String(amount));
    fd.append('amount', String(amount));   // older builds read this name
    fd.append('currency', currency?.currency || 'USD');
    if (method) fd.append('payment_method', method.type || 'Manual');
    fd.append('transaction_id', transactionId.trim());
    fd.append('file', {
      uri: proof.uri,
      type: proof.mimeType || 'image/jpeg',
      name: proof.fileName || 'proof.jpg',
    });
    try {
      await ApiService.submitManualDeposit(fd);
      showToast({ kind: 'success', message: 'Submitted — pending admin review' });
      nav.goBack();
    } catch (e) {
      showToast({ kind: 'error', message: e?.message || 'Submit failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <IconButton icon={<Ionicons name="chevron-back" size={22} color={vx.textPrimary} />} accessibilityLabel="Back" onPress={() => nav.goBack()} />
        <Text style={styles.title}>Manual Deposit</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: BOTTOM_NAV_PILL_HEIGHT + space.huge }}>
        {banks.length > 0 ? (
          <Card style={{ marginBottom: space.md }}>
            <Text style={styles.sectionTitle}>Bank Accounts</Text>
            {banks.map((b, idx) => (
              <View key={idx} style={[styles.detailBlock, idx < banks.length - 1 && styles.detailBorder]}>
                <Detail label="Bank" value={b.bank_name || b.name || '—'} />
                <Detail label="Account" value={b.account_number || '—'} />
                <Detail label="IFSC" value={b.ifsc || '—'} />
                <Detail label="Holder" value={b.account_holder || b.holder || '—'} />
              </View>
            ))}
          </Card>
        ) : null}

        {upiIds.length > 0 ? (
          <Card style={{ marginBottom: space.md }}>
            <Text style={styles.sectionTitle}>UPI</Text>
            {upiIds.map((u, idx) => (
              <Detail key={idx} label={u.label || 'UPI ID'} value={u.upi_id || u.id || '—'} />
            ))}
          </Card>
        ) : null}

        {methods.length > 1 ? (
          <>
            <Text style={styles.label}>Pay to</Text>
            <View style={styles.chips}>
              {methods.map((m) => (
                <Pressable key={m.id} onPress={() => setMethod(m)} style={[styles.chip, method?.id === m.id && styles.chipOn]}>
                  <Text style={[styles.chipTxt, method?.id === m.id && styles.chipTxtOn]}>
                    {m.bank_name || m.upi_id || m.type}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {currencies.length > 1 ? (
          <>
            <Text style={[styles.label, { marginTop: space.md }]}>Currency</Text>
            <View style={styles.chips}>
              {currencies.map((c) => (
                <Pressable key={c.currency} onPress={() => setCurrency(c)} style={[styles.chip, currency?.currency === c.currency && styles.chipOn]}>
                  <Text style={[styles.chipTxt, currency?.currency === c.currency && styles.chipTxtOn]}>
                    {c.symbol ? `${c.symbol} ` : ''}{c.currency}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={[styles.label, { marginTop: space.md }]}>
          Amount ({currency?.currency || 'USD'})
        </Text>
        <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={vx.textMuted} style={styles.input} />
        {usdPreview != null ? (
          <Text style={styles.convert}>
            ≈ ${usdPreview.toFixed(2)} will be credited (rate {Number(currency.rate_to_usd).toFixed(2)}
            {Number(currency.markup) > 0 ? ` + ${currency.markup}% markup` : ''})
          </Text>
        ) : null}

        <Text style={[styles.label, { marginTop: space.md }]}>Your transaction reference</Text>
        <TextInput value={transactionId} onChangeText={setTransactionId} placeholder="UTR / UPI ref" placeholderTextColor={vx.textMuted} style={styles.input} autoCapitalize="none" />

        <Text style={[styles.label, { marginTop: space.md }]}>Payment proof (screenshot)</Text>
        <Pressable onPress={pickProof} style={styles.proofBtn} accessibilityRole="button">
          {proof ? (
            <Image source={{ uri: proof.uri }} style={styles.proofImg} resizeMode="cover" />
          ) : (
            <View style={styles.proofPlaceholder}>
              <Ionicons name="image-outline" size={28} color={vx.textMuted} />
              <Text style={styles.proofTxt}>Tap to choose image</Text>
            </View>
          )}
        </Pressable>

        <PillButton
          label={submitting ? 'Submitting…' : 'Submit for Review'}
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={!proof || !(Number(amount) > 0) || !transactionId.trim() || submitting}
          onPress={submit}
          style={{ marginTop: space.xl }}
        />
      </ScrollView>
    </Screen>
  );
}

function Detail({ label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLab}>{label}</Text>
      <Text style={styles.detailVal} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill,
    backgroundColor: vx.bgElevated, borderWidth: 1, borderColor: vx.border,
  },
  chipOn: { borderColor: vx.accent, backgroundColor: vx.accent + '18' },
  chipTxt: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },
  chipTxtOn: { color: vx.accent },
  convert: { color: vx.textMuted, fontFamily, fontSize: sizes.label, marginTop: 6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs },
  title: { flex: 1, color: vx.textPrimary, fontFamily, fontSize: sizes.h2, fontWeight: weights.heavy, textAlign: 'center' },
  label: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, marginBottom: space.sm },
  sectionTitle: { color: vx.textPrimary, fontFamily, fontSize: sizes.h3, fontWeight: weights.bold, marginBottom: space.sm },
  input: { backgroundColor: vx.bgElevated, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, color: vx.textPrimary, fontFamily, fontSize: sizes.body },
  detailBlock: { paddingVertical: space.sm },
  detailBorder: { borderBottomColor: vx.border, borderBottomWidth: StyleSheet.hairlineWidth },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLab: { color: vx.textMuted, fontFamily, fontSize: sizes.label },
  detailVal: { color: vx.textPrimary, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },
  proofBtn: { backgroundColor: vx.bgElevated, borderRadius: radius.md, overflow: 'hidden', minHeight: 140, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: vx.border, borderStyle: 'dashed' },
  proofImg: { width: '100%', height: 200 },
  proofPlaceholder: { alignItems: 'center', padding: space.lg, gap: space.sm },
  proofTxt: { color: vx.textMuted, fontFamily, fontSize: sizes.label },
});
