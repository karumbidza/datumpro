import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import type { RosterMember } from '../lib/data/chat-roster';
import {
  listPinnedMessages,
  listConversationFiles,
  getConversationAbout,
  unpinMessage,
  type PinnedMessage,
  type ConversationFile,
  type ChatAbout,
} from '../lib/data/chat';

type Tab = 'people' | 'pinned' | 'files' | 'about';

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

function fmtBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${mon} ${d.getDate()}`;
}

function Avatar({ member, size, online }: { member: RosterMember; size: number; online: boolean }) {
  const { colors } = useTheme();
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
        <Text style={{ color: '#ffffff', fontFamily: font.bodyBold, fontSize: size * 0.4 }}>{initials(member.name)}</Text>
      </View>
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: online ? colors.success : colors.subtle,
          borderWidth: 2,
          borderColor: colors.surface,
        }}
      />
    </View>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'people', label: 'People' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'files', label: 'Files' },
  { key: 'about', label: 'About' },
];

export function ChatMembersSheet({
  visible,
  onClose,
  conversationId,
  members,
  onlineIds,
  meId,
}: {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  members: RosterMember[];
  onlineIds: Set<string>;
  meId: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('people');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? members.find((m) => m.userId === selectedId) ?? null : null;

  const [pinned, setPinned] = useState<PinnedMessage[] | null>(null);
  const [files, setFiles] = useState<ConversationFile[] | null>(null);
  const [about, setAbout] = useState<ChatAbout | null>(null);

  const online = members.filter((m) => onlineIds.has(m.userId));
  const offline = members.filter((m) => !onlineIds.has(m.userId));

  // Reset to a clean People view whenever the sheet re-opens so tab data refetches.
  useEffect(() => {
    if (!visible) {
      setTab('people');
      setSelectedId(null);
      setPinned(null);
      setFiles(null);
      setAbout(null);
    }
  }, [visible]);

  // Lazily load each tab's data the first time it's shown.
  useEffect(() => {
    if (!visible) return;
    if (tab === 'pinned' && pinned === null) listPinnedMessages(conversationId).then(setPinned).catch(() => setPinned([]));
    if (tab === 'files' && files === null) listConversationFiles(conversationId).then(setFiles).catch(() => setFiles([]));
    if (tab === 'about' && about === null)
      getConversationAbout(conversationId)
        .then(setAbout)
        .catch(() => setAbout({ topic: null, description: null, note: null, createdByName: null, createdAt: null }));
  }, [visible, tab, conversationId, pinned, files, about]);

  function close() {
    setSelectedId(null);
    onClose();
  }

  async function unpin(messageId: string) {
    setPinned((prev) => (prev ? prev.filter((p) => p.messageId !== messageId) : prev));
    try {
      await unpinMessage(messageId);
    } catch {
      // Reload on failure to resync.
      listPinnedMessages(conversationId).then(setPinned).catch(() => {});
    }
  }

  const title = selected ? 'Member' : TABS.find((t) => t.key === tab)!.label;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          {selected ? (
            <Pressable onPress={() => setSelectedId(null)} hitSlop={10} style={styles.back}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
          ) : (
            <View style={styles.back} />
          )}
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={close} hitSlop={10}>
            <Text style={styles.cancel}>Done</Text>
          </Pressable>
        </View>

        {!selected && (
          <View style={styles.tabBar}>
            {TABS.map((t) => (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
                <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {selected ? (
          <MemberDetail member={selected} online={onlineIds.has(selected.userId)} meId={meId} styles={styles} colors={colors} />
        ) : tab === 'people' ? (
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
        ) : tab === 'pinned' ? (
          <TabScroll data={pinned} empty="Nothing pinned. Long-press a message to pin it here." styles={styles} colors={colors}>
            {(list) =>
              list.map((p) => (
                <View key={p.pinId} style={styles.pinRow}>
                  <View style={styles.pinBody}>
                    <Text style={styles.pinText}>
                      {p.body ? (p.body.length > 160 ? `${p.body.slice(0, 160)}…` : p.body) : 'Attachment'}
                    </Text>
                    <Text style={styles.pinMeta}>
                      {p.senderName ?? 'Member'} · {fmtDate(p.createdAt)}
                    </Text>
                  </View>
                  <Pressable onPress={() => void unpin(p.messageId)} hitSlop={8} style={styles.unpin}>
                    <Text style={styles.unpinText}>Unpin</Text>
                  </Pressable>
                </View>
              ))
            }
          </TabScroll>
        ) : tab === 'files' ? (
          <TabScroll data={files} empty="No files shared yet." styles={styles} colors={colors}>
            {(list) =>
              list.map((f) => (
                <Pressable
                  key={f.id}
                  style={styles.fileRow}
                  disabled={!f.url}
                  onPress={() => f.url && Linking.openURL(f.url)}
                >
                  <View style={styles.fileIcon}>
                    <Ionicons name={fileIcon(f.kind)} size={18} color={colors.subtle} />
                  </View>
                  <View style={styles.fileBody}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {f.filename || f.kind}
                    </Text>
                    <Text style={styles.fileMeta} numberOfLines={1}>
                      {f.senderName ? `${f.senderName} · ` : ''}
                      {fmtDate(f.createdAt)}
                      {f.sizeBytes ? ` · ${fmtBytes(f.sizeBytes)}` : ''}
                    </Text>
                  </View>
                  {f.url ? <Ionicons name="open-outline" size={18} color={colors.subtle} /> : null}
                </Pressable>
              ))
            }
          </TabScroll>
        ) : (
          <ScrollView contentContainerStyle={styles.aboutWrap}>
            {about === null ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
            ) : !about.topic && !about.description && !about.note ? (
              <Text style={styles.empty}>No topic set yet.</Text>
            ) : (
              <>
                {about.topic ? (
                  <View style={styles.aboutBlock}>
                    <Text style={styles.aboutLabel}>TOPIC</Text>
                    <Text style={styles.aboutTopic}>{about.topic}</Text>
                  </View>
                ) : null}
                {about.description ? (
                  <View style={styles.aboutBlock}>
                    <Text style={styles.aboutLabel}>DESCRIPTION</Text>
                    <Text style={styles.aboutText}>{about.description}</Text>
                  </View>
                ) : null}
                {about.note ? (
                  <View style={styles.aboutBlock}>
                    <Text style={styles.aboutLabel}>NOTE</Text>
                    <Text style={styles.aboutNote}>{about.note}</Text>
                  </View>
                ) : null}
                {about.createdByName || about.createdAt ? (
                  <Text style={styles.aboutFooter}>
                    Created{about.createdByName ? ` by ${about.createdByName}` : ''}
                    {about.createdAt ? ` · ${fmtDate(about.createdAt)}` : ''}
                  </Text>
                ) : null}
              </>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function fileIcon(kind: ConversationFile['kind']): keyof typeof Ionicons.glyphMap {
  return kind === 'image'
    ? 'image-outline'
    : kind === 'video'
      ? 'videocam-outline'
      : kind === 'audio'
        ? 'musical-notes-outline'
        : 'document-outline';
}

/** Shared scroll container for the Pinned / Files tabs — spinner, empty, or list. */
function TabScroll<T>({
  data,
  empty,
  styles,
  colors,
  children,
}: {
  data: T[] | null;
  empty: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  children: (list: T[]) => React.ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {data === null ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
      ) : data.length === 0 ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        children(data)
      )}
    </ScrollView>
  );
}

function MemberDetail({
  member,
  online,
  meId,
  styles,
  colors,
}: {
  member: RosterMember;
  online: boolean;
  meId: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  return (
    <ScrollView contentContainerStyle={styles.detail}>
      <Avatar member={member} size={72} online={online} />
      <Text style={styles.detailName}>
        {member.name}
        {member.userId === meId ? '  (You)' : ''}
      </Text>
      <Text style={[styles.detailStatus, online && styles.statusOn]}>
        {online ? 'Active now' : activeAgo(member.lastActiveAt)}
      </Text>
      <View style={styles.rolePill}>
        <Text style={styles.rolePillText}>{member.role}</Text>
      </View>

      <View style={styles.actions}>
        <Action
          icon="call-outline"
          label="Call"
          disabled={!member.phone}
          onPress={() => member.phone && Linking.openURL(`tel:${member.phone}`)}
          styles={styles}
          colors={colors}
        />
        <Action
          icon="mail-outline"
          label="Email"
          disabled={!member.email}
          onPress={() => member.email && Linking.openURL(`mailto:${member.email}`)}
          styles={styles}
          colors={colors}
        />
      </View>

      {(member.phone || member.email) && (
        <View style={styles.contact}>
          {member.phone && (
            <View style={styles.contactRow}>
              <Ionicons name="call-outline" size={16} color={colors.subtle} />
              <Text style={styles.contactText}>{member.phone}</Text>
            </View>
          )}
          {member.email && (
            <View style={styles.contactRow}>
              <Ionicons name="mail-outline" size={16} color={colors.subtle} />
              <Text style={styles.contactText} numberOfLines={1}>
                {member.email}
              </Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
      <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
    </Pressable>
  );
}

function Action({
  icon,
  label,
  disabled,
  onPress,
  styles,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  return (
    <Pressable style={[styles.action, disabled && styles.actionDisabled]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={20} color={disabled ? colors.subtle : colors.brand} />
      <Text style={[styles.actionText, disabled && { color: colors.subtle }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 14,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    back: { width: 40 },
    title: { fontSize: 16, fontFamily: font.bodyBold, color: c.text },
    cancel: { fontSize: 15, color: c.brand, fontFamily: font.bodySemi, width: 40, textAlign: 'right' },
    tabBar: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
    tabActive: { backgroundColor: c.sunk },
    tabText: { fontSize: 13, fontFamily: font.bodySemi, color: c.subtle },
    tabTextActive: { color: c.text },
    list: { padding: 12 },
    groupLabel: { fontSize: 10, fontFamily: font.bodyBold, letterSpacing: 0.5, color: c.subtle, marginTop: 12, marginBottom: 4, marginLeft: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
    rowText: { flex: 1 },
    rowName: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    rowSub: { fontSize: 12, color: c.subtle, marginTop: 1 },
    empty: { color: c.subtle, textAlign: 'center', marginTop: 24 },
    detail: { alignItems: 'center', padding: 24, gap: 8 },
    detailName: { fontSize: 18, fontFamily: font.bodyBold, color: c.text, marginTop: 6 },
    detailStatus: { fontSize: 13, color: c.subtle },
    statusOn: { color: c.success },
    rolePill: { backgroundColor: c.brandSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4, marginTop: 2 },
    rolePillText: { fontSize: 12, fontFamily: font.bodyBold, color: c.brand, textTransform: 'capitalize' },
    actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
    action: {
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: 24,
      backgroundColor: c.surface,
    },
    actionDisabled: { opacity: 0.5 },
    actionText: { fontSize: 12, fontFamily: font.bodySemi, color: c.brand },
    contact: { alignSelf: 'stretch', marginTop: 16, gap: 10 },
    contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    contactText: { fontSize: 14, color: c.text, flex: 1 },
    // Pinned
    pinRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    pinBody: { flex: 1 },
    pinText: { fontSize: 14, color: c.text },
    pinMeta: { fontSize: 11, color: c.subtle, marginTop: 3 },
    unpin: { paddingVertical: 2, paddingHorizontal: 4 },
    unpinText: { fontSize: 12, fontFamily: font.bodySemi, color: c.danger },
    // Files
    fileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    fileIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: c.sunk,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fileBody: { flex: 1 },
    fileName: { fontSize: 14, fontFamily: font.bodySemi, color: c.text },
    fileMeta: { fontSize: 11, color: c.subtle, marginTop: 2 },
    // About
    aboutWrap: { padding: 16, gap: 16 },
    aboutBlock: { gap: 4 },
    aboutLabel: { fontSize: 10, fontFamily: font.bodyBold, letterSpacing: 0.5, color: c.subtle },
    aboutTopic: { fontSize: 16, fontFamily: font.bodySemi, color: c.text },
    aboutText: { fontSize: 14, color: c.text, lineHeight: 20 },
    aboutNote: {
      fontSize: 14,
      color: c.accentDeep,
      backgroundColor: c.accentSoft,
      borderRadius: radius.sm,
      padding: 10,
    },
    aboutFooter: { fontSize: 12, color: c.subtle, marginTop: 4 },
  });
