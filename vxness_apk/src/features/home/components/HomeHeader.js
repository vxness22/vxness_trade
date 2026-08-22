import React, { useContext } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import { useNavigation } from '@react-navigation/native';

import { AuthContext } from '../../../app/providers/AuthContext';
import { IconButton } from '../../../components/vx';
import { parseAvatar, renderAvatar } from '../../../utils/avatarRender';
import { vx, space, sizes, weights, fontFamily } from '../../../theme/vxTheme';

export default function HomeHeader({ accountLabel, onPickAccount, onAddAccount }) {
  const nav = useNavigation();
  const { user } = useContext(AuthContext) || {};
  const av = parseAvatar(user?.avatar);   // reflects the avatar chosen in Profile

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => nav.navigate('ProfileMenu')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Open profile menu"
      >
        <View style={styles.avatarWrap}>
          <View style={[styles.avatar, styles.avatarFallback]}>
            {renderAvatar(av, 36)}
          </View>
        </View>
      </Pressable>

      {/* Account picker — sits right of the profile icon. */}
      {onPickAccount ? (
        <Pressable
          onPress={onPickAccount}
          hitSlop={6}
          style={styles.acctChip}
          accessibilityRole="button"
          accessibilityLabel="Switch account"
        >
          <Text style={styles.acctChipTxt} numberOfLines={1}>{accountLabel || 'All accounts'}</Text>
          <Ionicons name="chevron-down" size={14} color={vx.textSecondary} />
        </Pressable>
      ) : null}
      {onAddAccount ? (
        <Pressable
          onPress={onAddAccount}
          hitSlop={6}
          style={styles.addBtn}
          accessibilityRole="button"
          accessibilityLabel="Add account"
        >
          <Ionicons name="add" size={18} color={vx.textPrimary} />
        </Pressable>
      ) : null}

      <View style={{ flex: 1 }} />

      {/* No search icon on Home — instrument search lives in the Markets tab,
          which has its own header search. And no bell: the platform has no
          notification feed to ring about, on the web or here. */}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.xs,
  },
  avatarWrap: { padding: 2 },
  avatar: {
    width: 36, height: 36, borderRadius: 18, overflow: 'hidden',
  },
  avatarFallback: {
    backgroundColor: vx.bgRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarAnim: { width: 30, height: 30 },

  acctChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginLeft: space.sm,
    backgroundColor: vx.bgRaised, borderWidth: 1, borderColor: vx.border,
    borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 6, maxWidth: 180,
  },
  acctChipTxt: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, fontWeight: weights.semibold, flexShrink: 1 },
  addBtn: {
    width: 32, height: 32, borderRadius: 16, marginLeft: space.xs,
    backgroundColor: vx.bgRaised, borderWidth: 1, borderColor: vx.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
