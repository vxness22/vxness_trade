import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { QuickActionTile } from '../../../components/vx';
import { vx, space } from '../../../theme/vxTheme';

export default function QuickActionsGrid() {
  const nav = useNavigation();
  const iconColor = vx.textPrimary;
  return (
    <View style={styles.row}>
      <QuickActionTile
        variant="flat"
        icon={<Ionicons name="calculator-outline" size={30} color={iconColor} />}
        label="Risk Calc"
        onPress={() => nav.navigate('RiskCalculator')}
      />
      <QuickActionTile
        variant="flat"
        icon={<Ionicons name="calendar-outline" size={30} color={iconColor} />}
        label="Calendar"
        onPress={() => nav.navigate('EconomicCalendar')}
      />
      <QuickActionTile
        variant="flat"
        icon={<Ionicons name="school-outline" size={30} color={iconColor} />}
        label="Academy"
        onPress={() => nav.navigate('Academy')}
      />
      <QuickActionTile
        variant="flat"
        icon={<Ionicons name="people-outline" size={30} color={iconColor} />}
        label="IB"
        onPress={() => nav.navigate('Business', { initialTab: 'ib' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
});
