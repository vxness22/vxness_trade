import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { vx, space, sizes, weights, fontFamily } from '../../theme/vxTheme';

export default function BalanceBlock({
  label,
  amount,
  currency = 'USD',
  hidden,
  onToggleHide,
  subLabel,
  subAmount,
  subPositive,
  subColor,
  accountLabel,
  onPickAccount,
  onAddAccount,
  showControls = true,
  showBalance = true,
  light = false,
}) {
  const whiteIf = light ? { color: '#FFFFFF' } : null;
  return (
    <View style={styles.wrap}>
      {showControls ? (
        <View style={styles.labRow}>
          <View style={styles.labLeft}>
            {label ? <Text style={styles.label}>{label}</Text> : null}
            {onToggleHide ? (
              <Pressable onPress={onToggleHide} hitSlop={10} accessibilityRole="button" accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'}>
                <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={14} color={vx.textMuted} />
              </Pressable>
            ) : null}
          </View>
          {(onPickAccount || onAddAccount) ? (
            <View style={styles.acctControls}>
              {onPickAccount ? (
                <Pressable onPress={onPickAccount} hitSlop={6} style={styles.acctChip} accessibilityRole="button" accessibilityLabel="Switch account">
                  <Text style={styles.acctChipTxt} numberOfLines={1}>{accountLabel || 'All accounts'}</Text>
                  <Ionicons name="chevron-down" size={14} color={vx.textSecondary} />
                </Pressable>
              ) : null}
              {onAddAccount ? (
                <Pressable onPress={onAddAccount} hitSlop={6} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="Add account">
                  <Ionicons name="add" size={18} color={vx.textPrimary} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {showBalance ? (
        <>
          <View style={styles.amtRow}>
            <Text style={[styles.amount, whiteIf]}>
              {hidden ? '••••••' : formatMoney(amount)}
            </Text>
            <View style={[styles.ccyChip, light && styles.ccyChipLight]}>
              <Text style={[styles.ccyTxt, whiteIf]}>{currency} ▾</Text>
            </View>
          </View>
          {subLabel ? (
            <View style={styles.subRow}>
              <Text style={[styles.subLab, whiteIf]}>{subLabel}</Text>
              <Text style={[styles.subAmt, { color: subColor || (subPositive ? vx.up : vx.down) }]}>
                {hidden ? '••' : (subAmount != null ? formatSigned(subAmount) : '—')}
              </Text>
              <Text style={[styles.subLab, whiteIf]}>{currency}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function formatMoney(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatSigned(v) {
  const sign = v >= 0 ? '+' : '−';
  return sign + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const styles = StyleSheet.create({
  wrap: { gap: 4, paddingVertical: space.sm },
  labRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  labLeft: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  label: { color: vx.textMuted, fontFamily, fontSize: sizes.label },
  acctControls: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  acctChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: vx.bgRaised, borderWidth: 1, borderColor: vx.border,
    borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 6, maxWidth: 180,
  },
  acctChipTxt: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, fontWeight: weights.semibold, flexShrink: 1 },
  addBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: vx.bgRaised, borderWidth: 1, borderColor: vx.border,
    alignItems: 'center', justifyContent: 'center',
  },
  amtRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  amount: { color: vx.textPrimary, fontFamily, fontSize: sizes.hero, fontWeight: weights.heavy },
  ccyChip: { backgroundColor: vx.bgRaised, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: 6 },
  ccyChipLight: { backgroundColor: 'rgba(0,0,0,0.28)' },
  ccyTxt: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, fontWeight: weights.semibold },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  subLab: { color: vx.textMuted, fontFamily, fontSize: sizes.label },
  subAmt: { fontFamily, fontSize: sizes.body, fontWeight: weights.bold },
});
