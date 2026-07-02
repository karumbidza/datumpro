import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) setError(error.message);
    // On success the AuthGate redirects into the app.
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>DatumPro Field</Text>
      <Text style={styles.subtitle}>Sign in to your site account</Text>

      <TextInput
        style={styles.input}
        placeholder="you@company.com"
        placeholderTextColor="#a1a1aa"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#a1a1aa"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={signIn}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 12, backgroundColor: '#fff' },
  brand: { fontSize: 24, fontWeight: '700', color: '#18181b' },
  subtitle: { fontSize: 14, color: '#71717a', marginBottom: 8 },
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
