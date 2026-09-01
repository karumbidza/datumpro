import { View, Text, Image, StyleSheet } from 'react-native';
import { font } from './theme';

/** Deterministic avatar hues. `senderIndex` maps a user id onto this palette so a
 *  person's avatar and message-bubble tint always share one colour. */
const AVATAR_COLORS = ['#2563eb', '#7e22ce', '#c2410c', '#15803d', '#b45309', '#db2777', '#0891b2', '#4f46e5'];

export function senderIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % AVATAR_COLORS.length;
}

export function avatarColor(id: string): string {
  return AVATAR_COLORS[senderIndex(id)]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first[0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Per-person bubble tint for other people's messages — the hue at low opacity so
 *  it reads on both light and dark surfaces without a theme lookup. */
export function senderTint(id: string): { bg: string; border: string } {
  const hue = avatarColor(id);
  return { bg: hue + '24', border: hue + '40' };
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  pm: 'Project manager',
  contractor: 'Contractor',
  client: 'Client',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

export function roleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABELS[role] ?? null;
}

/** Profile picture, or deterministic coloured initials as a fallback. */
export function Avatar({
  name,
  avatarUrl,
  userId,
  size = 32,
}: {
  name: string;
  avatarUrl?: string | null;
  userId: string;
  size?: number;
}) {
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(userId) },
      ]}
    >
      <Text style={{ color: '#fff', fontFamily: font.bodyBold, fontSize: size * 0.4 }}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
