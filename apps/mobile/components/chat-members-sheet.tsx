import { useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import type { RosterMember } from '../lib/data/chat-roster';

const ONLINE = '#22c55e';
const OFFLINE = '#d4d4d8';
const AVATAR_COLORS = ['#2563eb', '#7e22ce', '#c2410c', '#15803d', '#b45309', '#db2777', '#0891b2'];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first[0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function activeAgo(iso: string | null): string {
  if (!iso) return 'Offline';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'Active just now';
  const m = Math.floor(secs / 60);
  if (m < 60) return `Active ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Active ${h}h ago`;
  return `Active ${Math.floor(h / 24)}d ago`;
}

function Avatar({ member, size, online }: { member: RosterMember; size: number; online: boolean }) {
  const dot = size >= 60 ? 15 : 10;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarColor(member.userId),
          alignItems: 'center',
          justifyContent: 'center',
          opacity: online ? 1 : 0.55,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>{initials(member.name)}</Text>
      </View>
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: online ? ONLINE : OFFLINE,
          borderWidth: 2,
          borderColor: '#fff',
        }}
      />
    </View>
  );
}

export function ChatMembersSheet({
  visible,
  onClose,
  members,
  onlineIds,
  meId,
}: {
  visible: boolean;
  onClose: () => void;
  members: RosterMember[];
  onlineIds: Set<string>;
  meId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? members.find((m) => m.userId === selectedId) ?? null : null;

  const online = members.filter((m) => onlineIds.has(m.userId));
  const offline = members.filter((m) => !onlineIds.has(m.userId));

  function close() {
    setSelectedId(null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          {selected ? (
            <Pressable onPress={() => setSelectedId(null)} hitSlop={10} style={styles.back}>
              <Ionicons name="chevron-back" size={22} color={theme.color.text} />
            </Pressable>
          ) : (
            <View style={styles.back} />
          )}
          <Text style={styles.title}>{selected ? 'Member' : `People · ${online.length} online`}</Text>
          <Pressable onPress={close} hitSlop={10}>
            <Text style={styles.cancel}>Done</Text>
          </Pressable>
        </View>

        {selected ? (
          <ScrollView contentContainerStyle={styles.detail}>
            <Avatar member={selected} size={72} online={onlineIds.has(selected.userId)} />
            <Text style={styles.detailName}>
              {selected.name}
              {selected.userId === meId ? '  (You)' : ''}
            </Text>
            <Text style={[styles.detailStatus, onlineIds.has(selected.userId) && styles.statusOn]}>
              {onlineIds.has(selected.userId) ? 'Active now' : activeAgo(selected.lastActiveAt)}
            </Text>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{selected.role}</Text>
            </View>

            <View style={styles.actions}>
              <Action
                icon="call-outline"
                label="Call"
                disabled={!selected.phone}
                onPress={() => selected.phone && Linking.openURL(`tel:${selected.phone}`)}
              />
              <Action
                icon="mail-outline"
                label="Email"
                disabled={!selected.email}
                onPress={() => selected.email && Linking.openURL(`mailto:${selected.email}`)}
              />
            </View>

            {(selected.phone || selected.email) && (
              <View style={styles.contact}>
                {selected.phone && (
                  <View style={styles.contactRow}>
                    <Ionicons name="call-outline" size={16} color={theme.color.subtle} />
                    <Text style={styles.contactText}>{selected.phone}</Text>
                  </View>
                )}
                {selected.email && (
                  <View style={styles.contactRow}>
                    <Ionicons name="mail-outline" size={16} color={theme.color.subtle} />
                    <Text style={styles.contactText} numberOfLines={1}>
                      {selected.email}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {online.length > 0 && <Text style={styles.groupLabel}>ACTIVE NOW · {online.length}</Text>}
            {online.map((m) => (
              <Row key={m.userId} member={m} online meId={meId} onPress={() => setSelectedId(m.userId)} />
            ))}
            {offline.length > 0 && <Text style={styles.groupLabel}>OFFLINE · {offline.length}</Text>}
            {offline.map((m) => (
              <Row key={m.userId} member={m} online={false} meId={meId} onPress={() => setSelectedId(m.userId)} />
            ))}
            {members.length === 0 && <Text style={styles.empty}>No members yet.</Text>}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Row({
  member,
  online,
  meId,
  onPress,
}: {
  member: RosterMember;
  online: boolean;
  meId: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Avatar member={member} size={40} online={online} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {member.name}
          {member.userId === meId ? '  (You)' : ''}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {online ? member.role : activeAgo(member.lastActiveAt)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.color.subtle} />
    </Pressable>
  );
}

function Action({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.action, disabled && styles.actionDisabled]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={20} color={disabled ? theme.color.subtle : theme.color.accent} />
      <Text style={[styles.actionText, disabled && { color: theme.color.subtle }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: theme.color.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  back: { width: 40 },
  title: { fontSize: 16, fontWeight: '700', color: theme.color.text },
  cancel: { fontSize: 15, color: theme.color.accent, fontWeight: '600', width: 40, textAlign: 'right' },
  list: { padding: 12 },
  groupLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: theme.color.subtle, marginTop: 12, marginBottom: 4, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: theme.color.text },
  rowSub: { fontSize: 12, color: theme.color.subtle, marginTop: 1 },
  empty: { color: theme.color.subtle, textAlign: 'center', marginTop: 24 },
  detail: { alignItems: 'center', padding: 24, gap: 8 },
  detailName: { fontSize: 18, fontWeight: '700', color: theme.color.text, marginTop: 6 },
  detailStatus: { fontSize: 13, color: theme.color.subtle },
  statusOn: { color: theme.color.success },
  rolePill: { backgroundColor: theme.color.accentSoft, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 4, marginTop: 2 },
  rolePillText: { fontSize: 12, fontWeight: '700', color: theme.color.accent, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  action: {
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: theme.color.card,
  },
  actionDisabled: { opacity: 0.5 },
  actionText: { fontSize: 12, fontWeight: '600', color: theme.color.accent },
  contact: { alignSelf: 'stretch', marginTop: 16, gap: 10 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contactText: { fontSize: 14, color: theme.color.text, flex: 1 },
});
