import { useCallback, useMemo, useState } from 'react';
import { BrandLoader } from '../../../components/brand-loader';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase, currentUser } from '../../../lib/supabase';
import { useSession } from '../../../lib/auth';
import { Avatar } from '../../../components/ui';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { useResponsive } from '../../../lib/responsive';
import { unreadNotificationCount } from '../../../lib/data/notifications';

interface Profile {
  name: string;
  email: string | null;
  orgs: { name: string; role: string }[];
}

export default function More() {
  const { session } = useSession();
  const router = useRouter();
  const { colors, scheme, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useResponsive();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notifications, setNotifications] = useState(0);

  const load = useCallback(async () => {
    const user = await currentUser();
    if (!user) return;
    const [{ data: p }, { data: members }, unread] = await Promise.all([
      supabase.from('profiles').select('display_name, email').eq('id', user.id).maybeSingle(),
      supabase.from('org_members').select('role, organizations(name)').eq('user_id', user.id).eq('status', 'active'),
      unreadNotificationCount(),
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
    setNotifications(unread);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const cardShadow = scheme === 'light' && styles.shadow;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.content, { maxWidth: contentMaxWidth }]}>
        <Text style={styles.title}>More</Text>

        {!profile ? (
          <View style={{ marginTop: 24, alignSelf: 'center' }}>
            <BrandLoader />
          </View>
        ) : (
          <>
            {/* Profile */}
            <View style={[styles.card, cardShadow, styles.profileCard]}>
              <View style={styles.profileRow}>
                <Avatar name={profile.name} size={52} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {profile.name}
                  </Text>
                  {profile.email ? (
                    <Text style={styles.email} numberOfLines={1}>
                      {profile.email}
                    </Text>
                  ) : null}
                  {profile.orgs.length > 0 && (
                    <View style={styles.rolePill}>
                      <Text style={styles.rolePillText}>{profile.orgs[0]!.role}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Organisations */}
            {profile.orgs.length > 0 && (
              <View style={[styles.card, cardShadow, styles.orgCard]}>
                <Text style={styles.cardLabel}>Organisations</Text>
                {profile.orgs.map((o, i) => (
                  <View key={i} style={styles.orgRow}>
                    <Text style={styles.orgName} numberOfLines={1}>
                      {o.name}
                    </Text>
                    <Text style={styles.orgRole}>{o.role}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Notifications */}
            <Pressable
              onPress={() => router.push('/(app)/notifications')}
              style={({ pressed }) => [styles.card, cardShadow, styles.linkRow, pressed && styles.pressed]}
            >
              <View style={styles.linkIcon}>
                <Ionicons name="notifications-outline" size={19} color={colors.brandDeep} />
              </View>
              <Text style={styles.linkText}>Notifications</Text>
              {notifications > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{notifications}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
            </Pressable>

            {/* Compliance documents */}
            <Pressable
              onPress={() => router.push('/(app)/documents')}
              style={({ pressed }) => [styles.card, cardShadow, styles.linkRow, pressed && styles.pressed]}
            >
              <View style={styles.linkIcon}>
                <Ionicons name="document-text-outline" size={19} color={colors.brandDeep} />
              </View>
              <Text style={styles.linkText}>Compliance documents</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
            </Pressable>

            {/* Appearance */}
            <Pressable
              onPress={toggle}
              style={({ pressed }) => [styles.card, cardShadow, styles.linkRow, pressed && styles.pressed]}
            >
              <View style={styles.linkIcon}>
                <Ionicons
                  name={scheme === 'dark' ? 'moon-outline' : 'sunny-outline'}
                  size={19}
                  color={colors.brandDeep}
                />
              </View>
              <Text style={styles.linkText}>Appearance</Text>
              <Text style={styles.linkValue}>{scheme === 'dark' ? 'Dark' : 'Light'}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
            </Pressable>

            {/* Sign out */}
            <Pressable
              onPress={() => supabase.auth.signOut()}
              style={({ pressed }) => [styles.card, styles.signOut, pressed && styles.pressed]}
            >
              <View style={styles.signOutIcon}>
                <Ionicons name="log-out-outline" size={19} color={colors.danger} />
              </View>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>

            <Text style={styles.foot}>DatumPro Field · v2.0</Text>
            {session?.user.email ? (
              <Text style={styles.footSub}>Signed in as {session.user.email}</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, paddingBottom: 32, ...contentWidth },
    title: { fontSize: 26, fontFamily: font.displayBold, color: c.text },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
    },
    shadow: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 1,
    },
    pressed: { opacity: 0.85 },
    profileCard: { padding: 16, marginTop: 16 },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    name: { fontSize: 18, fontFamily: font.displayBold, color: c.text },
    email: { fontSize: 13, fontFamily: font.body, color: c.muted, marginTop: 2 },
    rolePill: {
      alignSelf: 'flex-start',
      backgroundColor: c.brandSoft,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 3,
      marginTop: 8,
    },
    rolePillText: { fontSize: 11, fontFamily: font.bodyBold, color: c.brandDeep, textTransform: 'capitalize' },
    orgCard: { padding: 16, marginTop: 12 },
    cardLabel: {
      fontSize: 11,
      fontFamily: font.bodyBold,
      color: c.muted,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    orgRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 12 },
    orgName: { fontSize: 14, fontFamily: font.bodySemi, color: c.text, flex: 1 },
    orgRole: { fontSize: 12, fontFamily: font.body, color: c.subtle, textTransform: 'capitalize' },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      marginTop: 12,
    },
    linkIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: c.brandSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkText: { flex: 1, fontSize: 15, fontFamily: font.bodyBold, color: c.text },
    linkValue: { fontSize: 13, fontFamily: font.body, color: c.muted },
    countBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 7,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    countBadgeText: { fontSize: 12, fontFamily: font.bodyBold, color: c.onAccent },
    signOut: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.dangerSoft,
      borderColor: c.dangerSoft,
      paddingVertical: 14,
      paddingHorizontal: 14,
      marginTop: 20,
    },
    signOutIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    signOutText: { fontSize: 15, fontFamily: font.bodyBold, color: c.danger },
    foot: { fontSize: 12, fontFamily: font.body, color: c.muted, textAlign: 'center', marginTop: 20 },
    footSub: { fontSize: 11, fontFamily: font.body, color: c.subtle, textAlign: 'center', marginTop: 4 },
  });
