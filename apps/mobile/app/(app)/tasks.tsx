import { View, Text, Pressable, StyleSheet } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/auth';

export default function Tasks() {
  const { session } = useSession();

  return (
    <View style={styles.screen}>
      <Text style={styles.hint}>
        Signed in as {session?.user.email ?? 'you'}. Your assigned tasks will appear here.
      </Text>

      <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 16, backgroundColor: '#fff' },
  hint: { fontSize: 14, color: '#52525b', lineHeight: 20 },
  signOut: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  signOutText: { color: '#3f3f46', fontWeight: '500' },
});
