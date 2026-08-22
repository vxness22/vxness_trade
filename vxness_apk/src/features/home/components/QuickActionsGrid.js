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
        icon={<Ionicons name="calendar-outline" size={30} color={iconColor} />}
        label="Calendar"
        onPress={() => nav.navigate('EconomicCalendar')}
      />
      <QuickActionTile
        variant="flat"
        icon={<Ionicons name="chatbubble-outline" size={30} color={iconColor} />}
        label="Support"
        onPress={() => nav.navigate('Support')}
      />
      <QuickActionTile
        variant="flat"
        icon={<Ionicons name="people-outline" size={30} color={iconColor} />}
        label="IB"
        onPress={() => nav.navigate('IB')}
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
