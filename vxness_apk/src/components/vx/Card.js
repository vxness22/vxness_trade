import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { vx, space, radius } from '../../theme/vxTheme';

export default function Card({
  children,
  padding = space.lg,
  borderRadius = radius.lg,
  variant = 'elevated', // 'elevated' | 'raised' | 'outline'
  onPress,
  style,
}) {
  const bg =
    variant === 'raised' ? vx.bgRaised :
    variant === 'outline' ? 'transparent' :
    vx.bgElevated;
  const border = variant === 'outline' ? vx.borderStrong : 'transparent';

  const inner = (
    <View
      style={[
        styles.card,
        { backgroundColor: bg, borderColor: border, borderWidth: variant === 'outline' ? 1 : 0, padding, borderRadius },
        style,
      ]}
    >
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        android_ripple={{ color: vx.bgPressed, borderless: false }}
        accessibilityRole="button"
      >
        {({ pressed }) => (
          <View style={pressed ? { opacity: 0.85 } : null}>{inner}</View>
        )}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  card: {},
});
