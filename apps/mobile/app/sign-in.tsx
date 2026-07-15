import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { supabase } from '../lib/supabase';

type Method = 'password' | 'code';

export default function SignIn() {
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
      <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="cover" />
      <Text style={styles.brand}>DatumPro Field</Text>
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

      <TextInput
        style={styles.input}
        placeholder="you@company.com"
        placeholderTextColor="#a1a1aa"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        editable={!codeSent}
      />

      {method === 'password' ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#a1a1aa"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={signInPassword} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>
          <Text style={styles.hint}>Signed up with Google or LinkedIn? Use “Email code” instead.</Text>
        </>
      ) : !codeSent ? (
        <>
          {info ? <Text style={styles.info}>{info}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={sendCode} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Email me a code</Text>}
          </Pressable>
          <Text style={styles.hint}>Works whether you signed up with a password, Google or LinkedIn.</Text>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            placeholderTextColor="#a1a1aa"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChangeText={setCode}
          />
          {info ? <Text style={styles.info}>{info}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={verifyCode} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify &amp; sign in</Text>}
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

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 12, backgroundColor: '#fff' },
  logo: { width: 88, height: 88, borderRadius: 20, alignSelf: 'center', marginBottom: 4 },
  brand: { fontSize: 24, fontWeight: '700', color: '#18181b' },
  subtitle: { fontSize: 14, color: '#71717a', marginBottom: 8 },
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#f4f4f5',
    borderRadius: 10,
    padding: 4,
    marginBottom: 4,
  },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: '#fff' },
  toggleText: { fontSize: 14, color: '#71717a', fontWeight: '600' },
  toggleTextActive: { color: '#18181b' },
  input: {
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#18181b',
  },
  error: { color: '#dc2626', fontSize: 13 },
  info: { color: '#3f3f46', fontSize: 13 },
  hint: { color: '#a1a1aa', fontSize: 12, textAlign: 'center', marginTop: 2 },
  link: { color: '#4f46e5', fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: 6 },
  button: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
