import React, { useState, useContext } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AuthContext } from '../../../app/providers/AuthContext';
import { Screen, showToast } from '../../../components/vx';
import { space, sizes, weights, fontFamily, radius } from '../../../theme/vxTheme';

// Same local palette the sign-in screen uses. The auth screens are deliberately
// dark regardless of the app theme, so they carry their own colours rather than
// reading the themed tokens.
const THEME = '#2FBF71';
const C = {
  inputBg:       '#31302E',
  border:        '#3D3C3A',
  textPrimary:   '#FFFFFF',
  textSecondary: '#9A9A9A',
  textMuted:     '#5E5E5E',
};

/**
 * Read-only sign-in for someone the account owner wants to let watch.
 *
 * The credential is the trading account NUMBER plus the investor password an
 * admin sets on that account — not an email, and not the owner's password. The
 * session that comes back can read everything the owner can on that one
 * account and write nothing: the server refuses every non-GET request on it, so
 * the hidden buttons elsewhere in the app are a courtesy, not the control.
 */
export default function InvestorLoginScreen({ navigation }) {
  const { investorLogin } = useContext(AuthContext);
  const [accountNumber, setAccountNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !!accountNumber.trim() && !!password && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const res = await investorLogin(accountNumber, password);
    setSubmitting(false);
    if (!res.success) {
      showToast({ kind: 'error', message: res.message || 'Investor login failed' });
    }
    // On success the root navigator swaps to the main tabs on its own — the
    // auth state change is what drives it, so there is nothing to navigate to.
  };

  return (
    <Screen edges={['top', 'bottom']} glow={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={C.textPrimary} />
          </Pressable>

          <View style={styles.header}>
            <View style={styles.badge}>
              <Ionicons name="eye-outline" size={26} color={THEME} />
            </View>
            <Text style={styles.title}>Investor Login</Text>
            <Text style={styles.subtitle}>
              View-only access to a trading account. You can see balances,
              positions and history — but not trade or move funds.
            </Text>
          </View>

          <Text style={styles.label}>Account number</Text>
          <TextInput
            style={styles.input}
            value={accountNumber}
            onChangeText={setAccountNumber}
            placeholder="e.g. 39001485"
            placeholderTextColor={C.textMuted}
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={styles.label}>Investor password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Investor password"
              placeholderTextColor={C.textMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} style={styles.eye}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.textMuted} />
            </Pressable>
          </View>

          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Log in as investor"
            style={({ pressed }) => [
              styles.submitBtn,
              { opacity: canSubmit ? (pressed ? 0.88 : 1) : 0.45 },
            ]}
          >
            {submitting
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.submitText}>View Account</Text>}
          </Pressable>

          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
            <Text style={styles.noteText}>
              Ask the account owner or your administrator for the investor password.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xl },
  back: { width: 40, height: 40, justifyContent: 'center' },

  header: { alignItems: 'center', marginTop: space.lg, marginBottom: space.xxl },
  badge: {
    width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME + '1A', borderWidth: 1, borderColor: THEME + '55', marginBottom: space.md,
  },
  title: { color: C.textPrimary, fontFamily, fontSize: 26, fontWeight: weights.heavy, textAlign: 'center' },
  subtitle: {
    color: C.textSecondary, fontFamily, fontSize: sizes.body,
    marginTop: space.sm, textAlign: 'center', lineHeight: 20,
  },

  label: { color: C.textSecondary, fontFamily, fontSize: sizes.label, marginBottom: 6, marginTop: space.md },
  input: {
    height: 52, borderRadius: radius.lg, paddingHorizontal: space.md,
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, fontFamily, fontSize: sizes.body,
  },
  passwordRow: {
    flexDirection: 'row', alignItems: 'center',
    height: 52, borderRadius: radius.lg, paddingHorizontal: space.md,
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
  },
  passwordInput: { flex: 1, color: C.textPrimary, fontFamily, fontSize: sizes.body },
  eye: { paddingLeft: space.sm },

  submitBtn: {
    marginTop: space.xl, height: 54, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', backgroundColor: THEME,
  },
  submitText: { color: '#FFFFFF', fontFamily, fontSize: sizes.h3, fontWeight: weights.bold },

  note: { flexDirection: 'row', gap: 8, marginTop: space.lg, paddingHorizontal: space.xs },
  noteText: { flex: 1, color: C.textMuted, fontFamily, fontSize: sizes.label, lineHeight: 18 },
});
