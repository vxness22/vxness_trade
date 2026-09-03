import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import useReadOnly from '../../hooks/useReadOnly';
import { vx, space, sizes, weights, fontFamily, radius } from '../../theme/vxTheme';

/**
 * Shown on screens whose actions an investor session cannot use.
 *
 * Renders nothing for a normal sign-in, so it is safe to drop in anywhere.
 * Without it a view-only user meets a screen whose buttons are simply gone and
 * has no way to tell that from a broken app.
 */
export default function ReadOnlyBanner({ text }) {
  const readOnly = useReadOnly();
  if (!readOnly) return null;

  return (
    <View style={styles.wrap}>
      <Ionicons name="eye-outline" size={16} color={vx.accent} />
      <Text style={styles.text}>
        {text || 'View-only access — actions are disabled for investor logins.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: vx.accent + '14',
    borderWidth: 1,
    borderColor: vx.accent + '44',
  },
  text: {
    flex: 1,
    color: vx.textSecondary,
    fontFamily,
    fontSize: sizes.label,
    fontWeight: weights.medium,
    lineHeight: 17,
  },
});
