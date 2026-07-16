import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { useSession } from '../../../lib/auth';
import { Card, Avatar } from '../../../components/ui';
import { theme, contentWidth } from '../../../lib/theme';
import { useResponsive } from '../../../lib/responsive';

interface Profile {
  name: string;
  email: string | null;
  orgs: { name: string; role: string }[];
}

export default function More() {
  const { session } = useSession();
  const router = useRouter();
  const { contentMaxWidth } = useResponsive();
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: p }, { data: members }] = await Promise.all([
      supabase.from('profiles').select('display_name, email').eq('id', user.id).maybeSingle(),
      supabase.from('org_members').select('role, organizations(name)').eq('user_id', user.id).eq('status', 'active'),
    ]);
    const prof = p as { display_name: string | null; email: string | null } | null;
    const orgs = ((members ?? []) as { role: string; organizations: { name: string | null } | { name: string | null }[] | null }[]).map(
      (m) => {
        const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
        return { name: org?.name ?? 'Organisation', role: m.role };
      },
    );
    setProfile({
      name: prof?.display_name || prof?.email?.split('@')[0] || 'You',
      email: prof?.email ?? user.email ?? null,
      orgs,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.content, { maxWidth: contentMaxWidth }]}>
        <Text style={styles.title}>More</Text>

        {!profile ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <>
            <Card style={{ marginTop: 12 }}>
              <View style={styles.profileRow}>
                <Avatar name={profile.name} size={48} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name}>{profile.name}</Text>
                  {profile.email ? <Text style={styles.email}>{profile.email}</Text> : null}
                </View>
              </View>
            </Card>

            {profile.orgs.length > 0 && (
              <Card style={{ marginTop: 12 }}>
                <Text style={styles.cardLabel}>Organisations</Text>
                {profile.orgs.map((o, i) => (
                  <View key={i} style={styles.orgRow}>
                    <Text style={styles.orgName}>{o.name}</Text>
                    <Text style={styles.orgRole}>{o.role}</Text>
                  </View>
                ))}
              </Card>
            )}

            <Pressable style={styles.linkRow} onPress={() => router.push('/(app)/notifications')}>
              <Ionicons name="notifications-outline" size={18} color={theme.color.text} />
              <Text style={styles.linkText}>Notifications</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.color.subtle} style={{ marginLeft: 'auto' }} />
            </Pressable>

            <Pressable style={styles.linkRow} onPress={() => router.push('/(app)/documents')}>
              <Ionicons name="document-text-outline" size={18} color={theme.color.text} />
              <Text style={styles.linkText}>Compliance documents</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.color.subtle} style={{ marginLeft: 'auto' }} />
            </Pressable>

            <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
              <Ionicons name="log-out-outline" size={18} color={theme.color.danger} />
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>

            <Text style={styles.foot}>Signed in as {session?.user.email}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  content: { padding: 20, ...contentWidth },
  title: { fontSize: 24, fontWeight: '800', color: theme.color.text },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 17, fontWeight: '700', color: theme.color.text },
  email: { fontSize: 13, color: theme.color.muted, marginTop: 1 },
  cardLabel: { fontSize: 12, fontWeight: '600', color: theme.color.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  orgRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  orgName: { fontSize: 14, color: theme.color.text },
  orgRole: { fontSize: 12, color: theme.color.subtle },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.color.dangerSoft,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  signOutText: { color: theme.color.danger, fontWeight: '700' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  linkText: { fontSize: 15, fontWeight: '600', color: theme.color.text },
  foot: { fontSize: 11, color: theme.color.subtle, textAlign: 'center', marginTop: 16 },
});
