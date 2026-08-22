import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Screen, IconButton } from '../../../components/vx';
import { vx, space, sizes, weights, fontFamily, radius } from '../../../theme/vxTheme';
import { BOTTOM_NAV_PILL_HEIGHT } from '../../../components/vx/BottomNavPill';
import LocalBankingPanel from '../components/LocalBankingPanel';

// Standalone Local Banking screen — the shared LocalBankingPanel also powers
// the Deposit screen's "Local Banking" section.
export default function DepositLocalBanking() {
  const nav = useNavigation();
  const route = useRoute();
  const [amount, setAmount] = useState(route.params?.amount ? String(route.params.amount) : '');

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <IconButton icon={<Ionicons name="chevron-back" size={22} color={vx.textPrimary} />} accessibilityLabel="Back" onPress={() => nav.goBack()} />
        <Text style={styles.title}>Local Banking</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: BOTTOM_NAV_PILL_HEIGHT + space.huge }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Amount (USD · optional)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 100"
          placeholderTextColor={vx.textMuted}
          style={styles.input}
        />
        <View style={{ marginTop: space.md }}>
          <LocalBankingPanel amount={amount} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs },
  title: { flex: 1, color: vx.textPrimary, fontFamily, fontSize: sizes.h2, fontWeight: weights.heavy, textAlign: 'center' },
  label: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, marginBottom: space.sm },
  input: { backgroundColor: vx.bgElevated, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, color: vx.textPrimary, fontFamily, fontSize: sizes.body },
});
