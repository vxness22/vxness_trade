import React, { useState, useContext } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AuthContext } from '../../../app/providers/AuthContext';
import { Screen, PillButton, showToast } from '../../../components/vx';
import { vx, space, sizes, weights, fontFamily, radius } from '../../../theme/vxTheme';

// The web signup collects exactly these: name, email, phone with a dialling
// code, password. Matching that list here rather than the old country-name and
// referral fields, which the website never asked for.
const DIAL_CODES = [
  { iso: 'IN', code: '+91',  name: 'India' },
  { iso: 'US', code: '+1',   name: 'United States' },
  { iso: 'GB', code: '+44',  name: 'United Kingdom' },
  { iso: 'AE', code: '+971', name: 'UAE' },
  { iso: 'SG', code: '+65',  name: 'Singapore' },
  { iso: 'AU', code: '+61',  name: 'Australia' },
  { iso: 'CA', code: '+1',   name: 'Canada' },
  { iso: 'DE', code: '+49',  name: 'Germany' },
  { iso: 'FR', code: '+33',  name: 'France' },
  { iso: 'ZA', code: '+27',  name: 'South Africa' },
  { iso: 'NG', code: '+234', name: 'Nigeria' },
  { iso: 'PK', code: '+92',  name: 'Pakistan' },
];

function pwdStrength(p) {
  if (!p) return { score: 0, label: '—' };
  let s = 0;
  if (p.length >= 8) s += 1;
  if (/[A-Z]/.test(p)) s += 1;
  if (/[0-9]/.test(p)) s += 1;
  if (/[^A-Za-z0-9]/.test(p)) s += 1;
  return { score: s, label: ['Too weak','Weak','Fair','Good','Strong'][s] };
}

export default function SignupScreen({ navigation }) {
  const { registerStart } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [dial, setDial] = useState(DIAL_CODES[0]);
  const [dialPick, setDialPick] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const strength = pwdStrength(password);

  const onSubmit = async () => {
    if (!email.trim() || !password || !fullName.trim() || !phone.trim()) return;

    const cleanEmail = email.trim().toLowerCase();
    // Exactly the keys the website's signup posts. A single name is accepted —
    // the old screen split it and REJECTED anyone with one word in their name,
    // which the website has never done.
    const signupData = {
      firstName: fullName.trim(),
      email: cleanEmail,
      phone: phone.trim(),
      countryCode: dial.code,
      password,
    };
    setSubmitting(true);
    // Step 1 of the OTP signup: this emails a verification code. The account is
    // only created (and verified) once the code is confirmed on the next screen.
    const res = await registerStart(signupData);
    setSubmitting(false);
    if (!res.success) {
      showToast({ kind: 'error', message: res.message || 'Signup failed' });
      return;
    }
    navigation.navigate('RegisterOtp', { email: cleanEmail, password, signupData });
  };

  return (
    <Screen edges={['top','bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.brandWrap}>
            <Image source={require('../../../../assets/brand/vxness-logo.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.tagline}>Create your account</Text>
          </View>

          <Text style={styles.label}>Name</Text>
          <TextInput value={fullName} onChangeText={setFullName} placeholder="Enter your name" placeholderTextColor={vx.textMuted} autoCapitalize="words" style={styles.input} />

          <Text style={[styles.label, { marginTop: space.md }]}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={vx.textMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} />

          <Text style={[styles.label, { marginTop: space.md }]}>Phone number</Text>
          <View style={styles.phoneRow}>
            <Pressable onPress={() => setDialPick(!dialPick)} style={styles.dialBtn} accessibilityRole="button" accessibilityLabel="Select country code">
              <Text style={styles.dialIso}>{dial.iso}</Text>
              <Text style={styles.dialCode}>{dial.code}</Text>
              <Ionicons name={dialPick ? 'chevron-up' : 'chevron-down'} size={14} color={vx.textMuted} />
            </Pressable>
            <TextInput
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, ''))}
              placeholder="Enter phone number"
              placeholderTextColor={vx.textMuted}
              keyboardType="phone-pad"
              style={[styles.input, { flex: 1 }]}
            />
          </View>
          {dialPick ? (
            <View style={styles.dropdown}>
              {DIAL_CODES.map((c) => (
                <Pressable key={c.iso} onPress={() => { setDial(c); setDialPick(false); }} style={styles.dropdownRow} android_ripple={{ color: vx.bgPressed }}>
                  <Text style={{ color: c.iso === dial.iso ? vx.accent : vx.textPrimary, fontFamily, fontSize: sizes.body }}>
                    {c.name} ({c.code})
                  </Text>
                  {c.iso === dial.iso ? <Ionicons name="checkmark" size={18} color={vx.accent} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={[styles.label, { marginTop: space.md }]}>Password</Text>
          <View style={styles.pwdRow}>
            <TextInput value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={vx.textMuted} secureTextEntry={!showPwd} autoCapitalize="none" autoCorrect={false} style={[styles.input, { flex: 1, marginRight: space.sm }]} />
            <Pressable onPress={() => setShowPwd(!showPwd)} hitSlop={8} style={styles.eye}>
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color={vx.textMuted} />
            </Pressable>
          </View>
          {password ? (
            <View style={styles.strengthRow}>
              {[0,1,2,3].map((i) => (
                <View key={i} style={[styles.strengthBar, { backgroundColor: i < strength.score ? (strength.score < 2 ? vx.down : strength.score < 4 ? vx.accent : vx.up) : vx.bgPressed }]} />
              ))}
              <Text style={styles.strengthTxt}>{strength.label}</Text>
            </View>
          ) : null}

          {/* Terms as a note, exactly as the website presents it — it does
              not gate the button behind a checkbox. */}
          <Text style={styles.termsNote}>
            By creating an account, you agree to our <Text style={styles.link}>Terms & Service</Text>
          </Text>

          <PillButton
            label={submitting ? 'Creating…' : 'Create Account'}
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={!email.trim() || !password || !fullName.trim() || !phone.trim() || submitting}
            onPress={onSubmit}
            style={{ marginTop: space.xl }}
          />

          <View style={styles.loginRow}>
            <Text style={styles.muted}>Already have an account? </Text>
            <Pressable onPress={() => navigation.navigate('Login')} hitSlop={6}>
              <Text style={styles.link}>Log in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.xxl, flexGrow: 1 },
  brandWrap: { alignItems: 'center', marginBottom: space.xl },
  // Same 4:1 as the sign-in screen, so the mark is identical on both.
  logo: { width: 224, height: 56, marginBottom: space.md },
  tagline: { color: vx.textMuted, fontFamily, fontSize: sizes.body },
  label: { color: vx.textSecondary, fontFamily, fontSize: sizes.label, marginBottom: space.xs },
  input: {
    backgroundColor: vx.bgElevated, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.md,
    color: vx.textPrimary, fontFamily, fontSize: sizes.body,
  },
  pwdRow: { flexDirection: 'row', alignItems: 'center' },
  eye: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.xs },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthTxt: { color: vx.textMuted, fontFamily, fontSize: sizes.micro, marginLeft: space.sm },
  dropdown: { backgroundColor: vx.bgRaised, borderRadius: radius.md, marginTop: space.xs, paddingVertical: space.xs },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md, paddingVertical: space.md },
  link: { color: vx.accent, fontFamily, fontSize: sizes.label, fontWeight: weights.bold },
  muted: { color: vx.textMuted, fontFamily, fontSize: sizes.body },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dialBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: space.md, height: 48,
    borderRadius: radius.md, borderWidth: 1, borderColor: vx.border, backgroundColor: vx.bgRaised,
  },
  dialIso: { color: vx.textPrimary, fontFamily, fontSize: sizes.body, fontWeight: weights.bold },
  dialCode: { color: vx.textSecondary, fontFamily, fontSize: sizes.body },
  termsNote: {
    color: vx.textMuted, fontFamily, fontSize: sizes.label,
    textAlign: 'center', marginTop: space.lg, lineHeight: 17,
  },
  loginRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: space.xl },
});
