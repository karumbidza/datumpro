import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

type Method = 'password' | 'code';

export default function SignIn() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [method, setMethod] = useState<Method>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function reset() {
    setError(null);
    setInfo(null);
  }

  async function signInPassword() {
    if (busy) return;
    setBusy(true);
    reset();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
    // On success the AuthGate redirects into the app.
  }

  // Sends a one-time code to the member's email. Works for accounts created with
  // Google/LinkedIn (no password) and confirms unconfirmed emails. shouldCreateUser
  // is false — people join via a web invite first, never by signing in here.
  async function sendCode() {
    if (busy) return;
    if (!email.trim()) return setError('Enter your email first.');
    setBusy(true);
    reset();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setCodeSent(true);
    setInfo(`We emailed a 6-digit code to ${email.trim()}. Enter it below.`);
  }

  async function verifyCode() {
    if (busy) return;
    if (code.trim().length < 6) return setError('Enter the 6-digit code from your email.');
    setBusy(true);
    reset();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) setError(error.message);
    // On success the AuthGate redirects into the app.
  }

  return (
    <View style={styles.screen}>
      <View style={styles.brandTile}>
        <Ionicons name="stats-chart" size={34} color={colors.onBrand} />
      </View>
      <Text style={styles.brand}>datumpro Field</Text>
      <Text style={styles.subtitle}>Sign in to your site account</Text>

      {/* Method toggle */}
      <View style={styles.toggle}>
        <Pressable
          style={[styles.toggleBtn, method === 'password' && styles.toggleBtnActive]}
          onPress={() => { setMethod('password'); reset(); }}
        >
          <Text style={[styles.toggleText, method === 'password' && styles.toggleTextActive]}>Password</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, method === 'code' && styles.toggleBtnActive]}
          onPress={() => { setMethod('code'); reset(); }}
        >
          <Text style={[styles.toggleText, method === 'code' && styles.toggleTextActive]}>Email code</Text>
        </Pressable>
      </View>

      <View style={styles.field}>
        <Ionicons name="mail-outline" size={18} color={colors.subtle} style={styles.fieldIcon} />
        <TextInput
          style={styles.input}
          placeholder="you@company.com"
          placeholderTextColor={colors.subtle}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!codeSent}
        />
      </View>

      {method === 'password' ? (
        <>
          <View style={styles.field}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.subtle} style={styles.fieldIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.subtle}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={signInPassword} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>
          <Text style={styles.hint}>Signed up with Google or LinkedIn? Use “Email code” instead.</Text>
        </>
      ) : !codeSent ? (
        <>
          {info ? <Text style={styles.info}>{info}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={sendCode} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.buttonText}>Email me a code</Text>}
          </Pressable>
          <Text style={styles.hint}>Works whether you signed up with a password, Google or LinkedIn.</Text>
        </>
      ) : (
        <>
          <View style={styles.field}>
            <Ionicons name="keypad-outline" size={18} color={colors.subtle} style={styles.fieldIcon} />
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              placeholderTextColor={colors.subtle}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChangeText={setCode}
            />
          </View>
          {info ? <Text style={styles.info}>{info}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={verifyCode} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.buttonText}>Verify &amp; sign in</Text>}
          </Pressable>
          <Pressable onPress={sendCode} disabled={busy}>
            <Text style={styles.link}>Resend code</Text>
          </Pressable>
          <Pressable onPress={() => { setCodeSent(false); setCode(''); reset(); }} disabled={busy}>
            <Text style={styles.link}>Use a different email</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 12, backgroundColor: c.bg },
    brandTile: {
      width: 72,
      height: 72,
      borderRadius: radius.md,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 4,
    },
    brand: { fontSize: 24, fontFamily: font.displayBold, color: c.text, textAlign: 'center' },
    subtitle: { fontSize: 14, fontFamily: font.body, color: c.muted, marginBottom: 8, textAlign: 'center' },
    toggle: {
      flexDirection: 'row',
      backgroundColor: c.sunk,
      borderRadius: radius.sm,
      padding: 4,
      marginBottom: 4,
    },
    toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.sm - 4, alignItems: 'center' },
    toggleBtnActive: {
      backgroundColor: c.surface,
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
      elevation: 1,
    },
    toggleText: { fontSize: 14, fontFamily: font.bodySemi, color: c.muted },
    toggleTextActive: { color: c.text },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: 14,
    },
    fieldIcon: { marginRight: 10 },
    input: {
      flex: 1,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: font.body,
      color: c.text,
    },
    error: { color: c.danger, fontSize: 13, fontFamily: font.body },
    info: { color: c.muted, fontSize: 13, fontFamily: font.body },
    hint: { color: c.subtle, fontSize: 12, fontFamily: font.body, textAlign: 'center', marginTop: 2 },
    link: { color: c.brand, fontSize: 14, fontFamily: font.bodySemi, textAlign: 'center', paddingVertical: 6 },
    button: {
      backgroundColor: c.brand,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
  });
