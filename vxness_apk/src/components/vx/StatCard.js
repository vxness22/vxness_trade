import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from './Card';
import { vx, space, sizes, weights, fontFamily } from '../../theme/vxTheme';

export default function StatCard({ label, value, delta, deltaPositive }) {
  return (
    <Card style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {delta != null ? (
        <Text style={[styles.delta, { color: deltaPositive ? vx.up : vx.down }]}>
          {delta}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { minWidth: 110, gap: 2 },
  label: { color: vx.textMuted, fontFamily, fontSize: sizes.label },
  value: { color: vx.textPrimary, fontFamily, fontSize: sizes.h2, fontWeight: weights.heavy },
  delta: { fontFamily, fontSize: sizes.label, marginTop: 2 },
});
