import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

type Method = 'password' | 'code';

export default function SignIn() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
  // Google (no password) and confirms unconfirmed emails. shouldCreateUser is
  // false — people join via a web invite first, never by signing in here.
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
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Brand hero ────────────────────────────────────────────────────── */}
        <View style={[styles.hero, { paddingTop: insets.top + 28 }]}>
          {/* decorative rings, bleeding off the top-right */}
          <View style={styles.ring1} pointerEvents="none" />
          <View style={styles.ring2} pointerEvents="none" />

          <View style={styles.wordmarkRow}>
            <View style={styles.mark}>
              <Ionicons name="stats-chart" size={18} color={colors.onBrand} />
            </View>
            <Text style={styles.wordmark}>datumpro</Text>
          </View>

          <Text style={styles.heroHeadline}>Every task priced, tracked and paid — in one place.</Text>
          <Text style={styles.heroSub}>Run your projects, tasks and payments from the field.</Text>

          <View style={styles.proofRow}>
            <View style={styles.proof}>
              <View style={styles.dot} />
              <Text style={styles.proofText}>Secure &amp; role-based</Text>
            </View>
            <View style={styles.proof}>
              <View style={styles.dot} />
              <Text style={styles.proofText}>Real progress tracking</Text>
            </View>
          </View>
        </View>

        {/* ── Form ──────────────────────────────────────────────────────────── */}
        <View style={styles.form}>
          <Text style={styles.formTitle}>Sign in to your site account</Text>

          <View style={styles.toggle}>
            <Pressable
              style={[styles.toggleBtn, method === 'password' && styles.toggleBtnActive]}
              onPress={() => {
                setMethod('password');
                reset();
              }}
            >
              <Text style={[styles.toggleText, method === 'password' && styles.toggleTextActive]}>Password</Text>
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, method === 'code' && styles.toggleBtnActive]}
              onPress={() => {
                setMethod('code');
                reset();
              }}
            >
              <Text style={[styles.toggleText, method === 'code' && styles.toggleTextActive]}>Email code</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Work email</Text>
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
              <Text style={styles.label}>Password</Text>
              <View style={styles.field}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.subtle} style={styles.fieldIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
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
              <Text style={styles.hint}>Signed up with Google? Use “Email code” instead.</Text>
            </>
          ) : !codeSent ? (
            <>
              {info ? <Text style={styles.info}>{info}</Text> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={sendCode} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.buttonText}>Email me a code</Text>}
              </Pressable>
              <Text style={styles.hint}>Works whether you signed up with a password or Google.</Text>
            </>
          ) : (
            <>
              <Text style={styles.label}>6-digit code</Text>
              <View style={styles.field}>
                <Ionicons name="keypad-outline" size={18} color={colors.subtle} style={styles.fieldIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="123456"
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
              <Pressable
                onPress={() => {
                  setCodeSent(false);
                  setCode('');
                  reset();
                }}
                disabled={busy}
              >
                <Text style={styles.link}>Use a different email</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    scroll: { flexGrow: 1 },

    // Hero
    hero: {
      backgroundColor: c.brand,
      paddingHorizontal: 24,
      paddingBottom: 34,
      borderBottomLeftRadius: radius.lg,
      borderBottomRightRadius: radius.lg,
      overflow: 'hidden',
    },
    ring1: {
      position: 'absolute',
      right: -80,
      top: -80,
      width: 260,
      height: 260,
      borderRadius: 130,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
    },
    ring2: {
      position: 'absolute',
      right: -30,
      top: -30,
      width: 170,
      height: 170,
      borderRadius: 85,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.10)',
    },
    wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    mark: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.16)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    wordmark: { fontSize: 18, fontFamily: font.displayBold, color: c.onBrand, letterSpacing: -0.2 },
    heroHeadline: {
      marginTop: 22,
      fontSize: 25,
      lineHeight: 31,
      fontFamily: font.displayBold,
      color: c.onBrand,
      letterSpacing: -0.4,
      maxWidth: 320,
    },
    heroSub: {
      marginTop: 10,
      fontSize: 14,
      lineHeight: 20,
      fontFamily: font.body,
      color: 'rgba(255,255,255,0.82)',
      maxWidth: 300,
    },
    proofRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 18 },
    proof: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.85)' },
    proofText: { fontSize: 13, fontFamily: font.body, color: 'rgba(255,255,255,0.92)' },

    // Form
    form: { paddingHorizontal: 24, paddingTop: 26, gap: 10 },
    formTitle: { fontSize: 15, fontFamily: font.bodySemi, color: c.muted, marginBottom: 2 },
    toggle: {
      flexDirection: 'row',
      backgroundColor: c.sunk,
      borderRadius: radius.sm,
      padding: 4,
      marginBottom: 6,
    },
    toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm - 4, alignItems: 'center' },
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
    label: { fontSize: 12.5, fontFamily: font.bodySemi, color: c.muted, marginTop: 4, marginBottom: -2 },
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
    input: { flex: 1, paddingVertical: 13, fontSize: 15, fontFamily: font.body, color: c.text },
    error: { color: c.danger, fontSize: 13, fontFamily: font.body, marginTop: 2 },
    info: { color: c.muted, fontSize: 13, fontFamily: font.body, marginTop: 2 },
    hint: { color: c.subtle, fontSize: 12, fontFamily: font.body, textAlign: 'center', marginTop: 4 },
    link: { color: c.brand, fontSize: 14, fontFamily: font.bodySemi, textAlign: 'center', paddingVertical: 8 },
    button: {
      backgroundColor: c.brand,
      borderRadius: radius.md,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: 6,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
  });
