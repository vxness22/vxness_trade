import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { vx, space, sizes, weights, fontFamily, radius } from '../../theme/vxTheme';
import AnimatedPrice from './AnimatedPrice';

export default function BuySellSplit({
  bid,
  ask,
  spreadPoints,
  side,
  onChange,
  changePoints,
}) {
  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={() => onChange('sell')}
          style={[styles.half, styles.left, { backgroundColor: side === 'sell' ? vx.sellBtn : vx.sellBtnDim }]}
          accessibilityRole="button"
          accessibilityState={{ selected: side === 'sell' }}
        >
          <Text style={styles.lab}>Sell</Text>
          {/* Coloured action button: glide only. A green/red flash on a red Sell
              or green Buy face reads as a glitch, not as movement. */}
          <AnimatedPrice value={bid} digits={priceDigits(bid)} glide flash={false} color="#FFFFFF" style={styles.bigPrice} />
        </Pressable>
        <View style={styles.chip}>
          <Text style={styles.chipTxt}>{spreadPoints != null ? spreadPoints : '—'}</Text>
        </View>
        <Pressable
          onPress={() => onChange('buy')}
          style={[styles.half, styles.right, { backgroundColor: side === 'buy' ? vx.buyBtn : vx.buyBtnDim }]}
          accessibilityRole="button"
          accessibilityState={{ selected: side === 'buy' }}
        >
          <Text style={styles.lab}>Buy</Text>
          <AnimatedPrice value={ask} digits={priceDigits(ask)} glide flash={false} color="#FFFFFF" style={styles.bigPrice} />
        </Pressable>
      </View>
    </View>
  );
}

function priceDigits(p) {
  return Number.isFinite(Number(p)) && Math.abs(Number(p)) >= 1 ? 2 : 5;
}

function formatPrice(p) {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return p.toFixed(5);
}

const styles = StyleSheet.create({
  // Matches the weight the odometer used, so the button face is unchanged.
  bigPrice: {
    color: '#FFFFFF', fontFamily, fontSize: sizes.h3, fontWeight: weights.heavy,
    marginTop: 1, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  row: { flexDirection: 'row', alignItems: 'stretch', height: 58, position: 'relative' },
  half: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  left:  { borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg },
  right: { borderTopRightRadius: radius.lg, borderBottomRightRadius: radius.lg },
  chip: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: [{ translateX: -22 }, { translateY: -12 }],
    width: 44, height: 24,
    backgroundColor: vx.spreadChip,
    borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: vx.borderStrong,
    zIndex: 1,
  },
  chipTxt: { color: vx.textPrimary, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },
  lab: { color: vx.textPrimary, fontFamily, fontSize: sizes.label, fontWeight: weights.semibold },
  price: { color: vx.textPrimary, fontFamily, fontSize: sizes.h3, fontWeight: weights.heavy, marginTop: 1 },
  changeRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm, gap: space.sm },
  changeBar: { flex: 1, height: 3, flexDirection: 'row', borderRadius: 2, overflow: 'hidden' },
  changeSeg: { flex: 1, height: 3 },
  segLeft: { borderTopLeftRadius: 2, borderBottomLeftRadius: 2 },
  segRight: { borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  changeMarker: { alignItems: 'center', minWidth: 20 },
  changeArrow: { fontFamily, fontSize: 9, lineHeight: 11 },
  changeNum: { color: vx.textMuted, fontFamily, fontSize: sizes.micro, fontWeight: weights.semibold },
});
