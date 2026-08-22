import React from 'react';
import { View, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenGlow from './ScreenGlow';
import { vx } from '../../theme/vxTheme';

export default function Screen({ children, edges = ['top'], style, glow = true }) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle={vx.isDark ? 'light-content' : 'dark-content'} backgroundColor={vx.bg} translucent={false} />
      {glow ? <ScreenGlow /> : null}
      <SafeAreaView style={[styles.safe, style]} edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: vx.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
});
