import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { vx } from '../../theme/vxTheme';

const colors = {
  bgPrimary: vx.bg,
  border: vx.border,
  textPrimary: vx.textPrimary,
  textMuted: vx.textMuted,
};

export default function ScreenHeader({ title, subtitle, onBack, rightAction }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.bgPrimary, borderBottomColor: colors.border }]}>
      <View style={styles.row}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {rightAction || <View style={{ width: 40 }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, alignItems: 'flex-start' },
  titleWrap: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2 },
});
