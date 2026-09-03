import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import { Screen, PillButton, IconButton, showToast } from '../../../components/vx';
import { vx, space, sizes, weights, fontFamily, radius } from '../../../theme/vxTheme';
import { BOTTOM_NAV_PILL_HEIGHT } from '../../../components/vx/BottomNavPill';
import ApiService from '../../../services/api/ApiService';
import { showWithdrawKycGate } from '../../../utils/kycGate';

/**
 * Withdraw to one of the account holder's APPROVED payout accounts — the same
 * rule the website's Wallet page follows.
 *
 * This screen used to take a UPI id typed into a box, with an optional QR. That
 * meant money could be sent to an address no admin had ever seen, and the
 * server now refuses it. An account has to be submitted and approved first, so
 * there is a path to add one from here when the list is empty.
 */
export default function WithdrawManual() {
  const nav = useNavigation();

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [balance, setBalance] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Adding a new payout account.
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('Bank');
  const [form, setForm] = useState({ bank_name: '', account_number: '', account_holder_name: '', ifsc_code: '', upi_id: '' });
  const setField = (k) => (v) => setForm((p) => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    try {
      const [accRes, walletRes] = await Promise.all([
        ApiService.getWithdrawAccounts().catch(() => ({ items: [] })),
        ApiService.getWalletSummary().catch(() => null),
      ]);
      const list = Array.isArray(accRes?.items) ? accRes.items : [];
      setAccounts(list);
      setSelected((cur) => cur || (list[0]?.id ?? null));
      if (walletRes) setBalance(Number(walletRes.main_wallet_balance ?? 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const amt = Number(amount);
  const overBalance = balance != null && amt > balance;
  const canSubmit = !!selected && amt > 0 && !overBalance && !submitting;

  const submit = async () => {
    if (!selected) return showToast({ kind: 'warn', message: 'Choose a withdrawal account' });
    if (!(amt > 0)) return showToast({ kind: 'warn', message: 'Enter an amount' });
    if (overBalance) return showToast({ kind: 'warn', message: 'Amount is more than your wallet balance' });

    setSubmitting(true);
    const fd = new FormData();
    fd.append('amount', String(amt));
    fd.append('bank_account_id', String(selected));
    if (notes.trim()) fd.append('payout_notes', notes.trim());
    try {
      await ApiService.submitManualWithdrawal(fd);
      showToast({ kind: 'success', message: 'Withdrawal submitted for review' });
      nav.goBack();
    } catch (e) {
      const msg = e?.message || 'Submit failed';
      if (msg === 'KYC_REQUIRED') showWithdrawKycGate(nav);
      else showToast({ kind: 'error', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const addAccount = async () => {
    const payload = newType === 'UPI'
      ? { type: 'UPI', upi_id: form.upi_id.trim() }
      : {
          type: 'Bank',
          bank_name: form.bank_name.trim(),
          account_number: form.account_number.trim(),
          account_holder_name: form.account_holder_name.trim(),
          ifsc_code: form.ifsc_code.trim(),
        };
    try {
      const res = await ApiService.addWithdrawAccount(payload);
      showToast({ kind: 'success', message: res?.message || 'Submitted for approval' });
      setAdding(false);
      setForm({ bank_name: '', account_number: '', account_holder_name: '', ifsc_code: '', upi_id: '' });
      load();
    } catch (e) {
      showToast({ kind: 'error', message: e?.message || 'Could not add the account' });
    }
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <IconButton icon={<Ionicons name="chevron-back" size={22} color={vx.textPrimary} />} accessibilityLabel="Back" onPress={() => nav.goBack()} />
        <Text style={styles.title}>Withdraw</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: BOTTOM_NAV_PILL_HEIGHT + space.huge }}>
        {balance != null ? (
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Available</Text>
            <Text style={styles.balanceVal}>${balance.toFixed(2)}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Withdraw to</Text>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={vx.accent} /></View>
        ) : accounts.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="business-outline" size={30} color={vx.textMuted} />
            <Text style={styles.emptyTxt}>
              No approved payout account yet. Add one below — an admin approves it before
              a withdrawal can be sent to it.
            </Text>
          </View>
        ) : (
          accounts.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => setSelected(a.id)}
              style={[styles.acct, selected === a.id && styles.acctOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === a.id }}
            >
              <Ionicons
                name={selected === a.id ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={selected === a.id ? vx.accent : vx.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.acctLabel}>{a.label}</Text>
                <Text style={styles.acctSub}>
                  {a.type === 'UPI' ? 'UPI' : `${a.account_holder_name || ''}${a.ifsc_code ? ' · ' + a.ifsc_code : ''}`}
                </Text>
              </View>
            </Pressable>
          ))
        )}

        <Pressable onPress={() => setAdding((v) => !v)} style={styles.addRow} accessibilityRole="button">
          <Ionicons name={adding ? 'close' : 'add-circle-outline'} size={18} color={vx.accent} />
          <Text style={styles.addTxt}>{adding ? 'Cancel' : 'Add a payout account'}</Text>
        </Pressable>

        {adding ? (
          <View style={styles.addBox}>
            <View style={styles.segment}>
              {['Bank', 'UPI'].map((t) => (
                <Pressable key={t} onPress={() => setNewType(t)} style={[styles.segBtn, newType === t && styles.segOn]}>
                  <Text style={[styles.segTxt, newType === t && styles.segTxtOn]}>{t}</Text>
                </Pressable>
              ))}
            </View>

            {newType === 'UPI' ? (
              <>
                <Text style={styles.label}>UPI ID</Text>
                <TextInput value={form.upi_id} onChangeText={setField('upi_id')} placeholder="name@bank" placeholderTextColor={vx.textMuted} style={styles.input} autoCapitalize="none" autoCorrect={false} />
              </>
            ) : (
              <>
                <Text style={styles.label}>Bank name</Text>
                <TextInput value={form.bank_name} onChangeText={setField('bank_name')} placeholder="HDFC Bank" placeholderTextColor={vx.textMuted} style={styles.input} />
                <Text style={[styles.label, { marginTop: space.md }]}>Account number</Text>
                <TextInput value={form.account_number} onChangeText={setField('account_number')} keyboardType="number-pad" placeholder="123456789" placeholderTextColor={vx.textMuted} style={styles.input} />
                <Text style={[styles.label, { marginTop: space.md }]}>Account holder name</Text>
                <TextInput value={form.account_holder_name} onChangeText={setField('account_holder_name')} placeholder="As on the bank record" placeholderTextColor={vx.textMuted} style={styles.input} autoCapitalize="characters" />
                <Text style={[styles.label, { marginTop: space.md }]}>IFSC code</Text>
                <TextInput value={form.ifsc_code} onChangeText={setField('ifsc_code')} placeholder="HDFC0001234" placeholderTextColor={vx.textMuted} style={styles.input} autoCapitalize="characters" autoCorrect={false} />
              </>
            )}

            <PillButton label="Submit for approval" variant="secondary" size="md" onPress={addAccount} style={{ marginTop: space.md }} />
          </View>
        ) : null}

        <Text style={[styles.label, { marginTop: space.lg }]}>Amount (USD)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={vx.textMuted}
          style={[styles.input, overBalance && styles.inputBad]}
        />
        {overBalance ? <Text style={styles.bad}>More than your available balance.</Text> : null}

        <Text style={[styles.label, { marginTop: space.md }]}>Notes (optional)</Text>
        <TextInput value={notes} onChangeText={setNotes} placeholder="Anything the reviewer should know" placeholderTextColor={vx.textMuted} style={styles.input} />

        <PillButton
          label={submitting ? 'Submitting…' : 'Submit Withdrawal'}
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={!canSubmit}
          onPress={submit}
          style={{ marginTop: space.xl }}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs },
  title: { flex: 1, color: vx.textPrimary, fontFamily, fontSize: sizes.h2, fontWeight: weights.heavy, textAlign: 'center' },

  balanceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: vx.bgElevated, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.md, marginBottom: space.lg,
  },
  balanceLabel: { color: vx.textMuted, fontFamily, fontSize: sizes.label },
  balanceVal: { color: vx.up, fontFamily, fontSize: sizes.h3, fontWeight: weights.bold },

  label: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, marginBottom: space.sm },
  input: { backgroundColor: vx.bgElevated, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, color: vx.textPrimary, fontFamily, fontSize: sizes.body },
  inputBad: { borderWidth: 1, borderColor: vx.down },
  bad: { color: vx.down, fontFamily, fontSize: sizes.label, marginTop: 6 },

  loading: { paddingVertical: space.xl, alignItems: 'center' },
  empty: { alignItems: 'center', gap: space.sm, padding: space.lg, backgroundColor: vx.bgElevated, borderRadius: radius.md },
  emptyTxt: { color: vx.textMuted, fontFamily, fontSize: sizes.label, textAlign: 'center', lineHeight: 18 },

  acct: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: vx.bgElevated, borderRadius: radius.md,
    padding: space.md, marginBottom: space.sm,
    borderWidth: 1, borderColor: vx.border,
  },
  acctOn: { borderColor: vx.accent },
  acctLabel: { color: vx.textPrimary, fontFamily, fontSize: sizes.body, fontWeight: weights.bold },
  acctSub: { color: vx.textMuted, fontFamily, fontSize: sizes.label, marginTop: 2 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
  addTxt: { color: vx.accent, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },
  addBox: { marginTop: space.md, padding: space.md, backgroundColor: vx.bgRaised, borderRadius: radius.md },

  segment: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  segBtn: { flex: 1, paddingVertical: space.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: vx.bgElevated, borderWidth: 1, borderColor: vx.border },
  segOn: { borderColor: vx.accent, backgroundColor: vx.accent + '18' },
  segTxt: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },
  segTxtOn: { color: vx.accent },
});
