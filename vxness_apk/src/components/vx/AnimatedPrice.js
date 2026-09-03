import React, { useEffect, useRef } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';

import { vx } from '../../theme/vxTheme';

/**
 * A price that moves the way a broker's does — DISPLAY ONLY.
 *
 *   glide  the shown number rolls to the new value over ~150ms; a tick arriving
 *          mid-glide re-targets rather than restarting.
 *   flash  the TEXT tints green or red and eases back to its own colour. No
 *          background box.
 *
 * SAFETY — nothing here writes to a store, to state, or to a callback. Order
 * execution, P&L, margin and SL/TP all keep reading the real value; the fill a
 * trader gets is the real quote, never a frame of this animation.
 *
 * Built on an animated TextInput rather than <Text>: reanimated can drive
 * `text` as an animated prop, so the number is repainted on the UI thread and
 * React never re-renders while it moves. On Fabric there is no setNativeProps
 * escape hatch, so a state-driven glide would mean a render per frame per
 * price — with a watchlist of them that is exactly the render storm this is
 * meant to avoid. The input is not editable and not focusable, so it behaves
 * as a label.
 */
// `text` is not whitelisted as an animated prop by default, so this has to be
// declared before the component is created. Guarded because it lives on the
// default export rather than the package root, and a future major could move
// it — a missing helper should not take the whole screen down.
Animated.addWhitelistedNativeProps?.({ text: true });
const AnimText = Animated.createAnimatedComponent(TextInput);

const GLIDE_MS = 150;
const FLASH_MS = 450;

export default function AnimatedPrice({
  value,
  digits = 2,
  style,
  glide = true,
  flash = true,
  color,
}) {
  const shown = useSharedValue(Number.isFinite(Number(value)) ? Number(value) : 0);
  const tint = useSharedValue(0); // -1 down · 0 none · +1 up
  const hasValue = useSharedValue(Number.isFinite(Number(value)) ? 1 : 0);
  const prevRef = useRef(null);

  useEffect(() => {
    const next = Number(value);
    if (!Number.isFinite(next)) {
      hasValue.value = 0;
      prevRef.current = null;
      return;
    }

    const prev = prevRef.current;
    prevRef.current = next;
    hasValue.value = 1;

    // First value, or glide switched off: land on it immediately.
    if (prev === null || !glide) {
      shown.value = next;
      return;
    }
    if (prev === next) return;

    // withTiming from wherever the last glide had reached — reanimated retargets
    // in place, so a fast feed chases smoothly instead of snapping back.
    shown.value = withTiming(next, { duration: GLIDE_MS, easing: Easing.out(Easing.quad) });

    if (flash) {
      tint.value = withSequence(
        withTiming(next > prev ? 1 : -1, { duration: 0 }),
        withTiming(0, { duration: FLASH_MS, easing: Easing.out(Easing.quad) }),
      );
    }
  }, [value, glide, flash, shown, tint, hasValue]);

  const animatedProps = useAnimatedProps(() => ({
    text: hasValue.value ? shown.value.toFixed(digits) : '—',
    // `value` alongside `text` keeps Android in step; without it the first
    // paint can show the placeholder until the next frame.
    value: hasValue.value ? shown.value.toFixed(digits) : '—',
  }));

  const base = color || vx.textPrimary;
  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(tint.value, [-1, 0, 1], [vx.down, base, vx.up]),
  }));

  return (
    <AnimText
      animatedProps={animatedProps}
      style={[styles.base, style, animatedStyle]}
      editable={false}
      // Not a field: no focus, no caret, no keyboard, no screen-reader
      // announcement as an input.
      pointerEvents="none"
      focusable={false}
      caretHidden
      underlineColorAndroid="transparent"
      accessibilityRole="text"
      allowFontScaling={false}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    // A TextInput carries platform padding a Text does not; strip it so this
    // drops into existing layouts where a <Text> used to be.
    padding: 0,
    margin: 0,
    // Android gives TextInput a minimum height that would push rows taller.
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
});
