import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  Keyboard,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/auth';
import { font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import {
  listMessages,
  sendMessage,
  sendPhotoMessage,
  sendVoiceMessage,
  markConversationRead,
  pinMessage,
  toggleReaction,
  type ChatMessage,
} from '../lib/data/chat';

const EMOJIS = ['👍', '❤️', '😂', '🎉', '✅'];
import { getConversationRoster, type RosterMember } from '../lib/data/chat-roster';
import { ChatMembersSheet } from './chat-members-sheet';
import { VoiceNote } from './voice-note';
import { Avatar, senderTint, roleLabel } from '../lib/chat-identity';

/** The chat surface — message list, realtime sync, text + photo composer. Shared
 *  by the task discussion and the project team channel; the parent resolves the
 *  conversation id and passes it in (null while resolving or when there's none). */
export function ChatThread({
  conversationId,
  resolving,
  emptyText = 'No messages yet.',
}: {
  conversationId: string | null;
  resolving: boolean;
  emptyText?: string;
}) {
  const { session } = useSession();
  const meId = session?.user.id;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const insets = useSafeAreaInsets();
  // Single source of truth for how far the composer sits off the bottom: above
  // the keyboard when it's open, above the gesture nav bar when it's closed. This
  // is why the composer both stops overlapping the keyboard AND stops hiding
  // behind the Android gesture bar.
  const bottomSpace = kbHeight > 0 ? kbHeight : insets.bottom;

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  // Read the keyboard height directly from the IME event and lift the composer
  // by exactly that much. Works in Android edge-to-edge/immersive where the
  // window doesn't resize and KeyboardAvoidingView fails.
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
        setKbHeight(e.endCoordinates?.height ?? 0),
      ),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbHeight(0)),
      // Re-focusing the input while the keyboard is already up doesn't re-fire
      // didShow on Android — the frame change does. Only ever raise the composer
      // here (never zero it), so this can't flicker mid-animation.
      Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidChangeFrame', (e) => {
        const h = e.endCoordinates?.height ?? 0;
        if (h > 0) setKbHeight(h);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const onlineCount = members.filter((m) => onlineIds.has(m.userId)).length;
  // Identity lookup for the message list — company / role / avatar per sender.
  const rosterById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
  const [myName, setMyName] = useState('Someone');

  // My display name for the typing broadcast (so peers see who's typing).
  useEffect(() => {
    if (!meId) return;
    void supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', meId)
      .maybeSingle()
      .then(({ data }) => {
        const p = data as { display_name: string | null; email: string | null } | null;
        if (p) setMyName(p.display_name || p.email?.split('@')[0] || 'Someone');
      });
  }, [meId]);

  // Register a peer's typing signal; auto-clear after 3s of silence.
  const showTyping = useCallback(
    (payload: { userId?: string; name?: string }) => {
      const uid = payload?.userId;
      if (!uid || uid === meId) return;
      setTypingUsers((cur) => ({ ...cur, [uid]: payload.name || 'Someone' }));
      const existing = typingTimers.current[uid];
      if (existing) clearTimeout(existing);
      typingTimers.current[uid] = setTimeout(() => {
        setTypingUsers((cur) => {
          const next = { ...cur };
          delete next[uid];
          return next;
        });
      }, 3000);
    },
    [meId],
  );

  const reload = useCallback(async (id: string) => {
    setMessages(await listMessages(id));
    // Opening / viewing the thread clears its unread state.
    void markConversationRead(id);
  }, []);

  // Load the conversation's member roster (for the People sheet + presence).
  useEffect(() => {
    if (!conversationId) {
      setMembers([]);
      return;
    }
    let active = true;
    getConversationRoster(conversationId)
      .then((r) => active && setMembers(r))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [conversationId]);

  // Keep our own last_active_at fresh so others see an accurate "Active …" label.
  useEffect(() => {
    if (!meId) return;
    const iv = setInterval(() => {
      void supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', meId);
    }, 30_000);
    return () => clearInterval(iv);
  }, [meId]);

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      await reload(conversationId);
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase.channel(`chat:${conversationId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: meId ?? '' } },
      });
      channelRef.current = channel;
      channel
        .on('broadcast', { event: 'message' }, () => active && void reload(conversationId))
        .on('broadcast', { event: 'reaction' }, () => active && void reload(conversationId))
        .on('broadcast', { event: 'typing' }, ({ payload }) => showTyping(payload as { userId?: string; name?: string }))
        .on('presence', { event: 'sync' }, () => {
          const state = channel!.presenceState() as Record<string, { user_id?: string }[]>;
          const ids = new Set<string>();
          for (const arr of Object.values(state)) for (const m of arr) if (m.user_id) ids.add(m.user_id);
          if (active) setOnlineIds(ids);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED' && meId) {
            void channel!.track({ user_id: meId, name: session?.user.email ?? '' });
          }
        });
    })();

    return () => {
      active = false;
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [conversationId, reload, meId, session?.user.email, showTyping]);

  async function doPin(item: ChatMessage) {
    try {
      await pinMessage(item.id);
      Alert.alert('Pinned', 'Find it under People → Pinned.');
    } catch (e) {
      Alert.alert('Could not pin', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  async function onReact(messageId: string, emoji: string) {
    if (!conversationId) return;
    try {
      await toggleReaction(messageId, emoji);
      await reload(conversationId);
      // Peers don't get self-broadcasts, so tell them a reaction changed.
      channelRef.current?.send({ type: 'broadcast', event: 'reaction', payload: { messageId } });
    } catch (e) {
      Alert.alert('Could not react', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  // Broadcast a typing signal on keystroke, throttled — same event the web listens for.
  function onChangeInput(text: string) {
    setInput(text);
    const now = Date.now();
    if (meId && channelRef.current && now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now;
      channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId: meId, name: myName } });
    }
  }

  async function submit() {
    if (!conversationId || sending) return;
    const body = input.trim();
    if (!body) return;
    setSending(true);
    setInput('');
    try {
      await sendMessage(conversationId, body);
      await reload(conversationId);
    } finally {
      setSending(false);
    }
  }

  async function attachPhoto(fromCamera: boolean) {
    if (!conversationId || sending) return;
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Enable camera / photo access in Settings to share photos.');
      return;
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ['images'] });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset?.base64) return;
    setSending(true);
    try {
      const ext = (asset.mimeType?.split('/')[1] || asset.uri.split('.').pop() || 'jpg').toLowerCase();
      await sendPhotoMessage({
        conversationId,
        base64: asset.base64,
        ext,
        mime: asset.mimeType ?? 'image/jpeg',
        width: asset.width,
        height: asset.height,
        sizeBytes: asset.fileSize ?? null,
      });
      await reload(conversationId);
    } catch (e) {
      Alert.alert('Could not send photo', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  function pickPhoto() {
    Alert.alert('Share a photo', undefined, [
      { text: 'Take photo', onPress: () => void attachPhoto(true) },
      { text: 'Choose from library', onPress: () => void attachPhoto(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function startRecording() {
    if (!conversationId || sending || recorderState.isRecording) return;
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone needed', 'Enable microphone access in Settings to record voice notes.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  async function cancelRecording() {
    try {
      await recorder.stop();
    } catch {
      // already stopped
    }
  }

  async function stopAndSendRecording() {
    if (!conversationId) return;
    const durationMs = recorderState.durationMillis;
    try {
      await recorder.stop();
    } catch {
      return;
    }
    const uri = recorder.uri;
    // Ignore accidental taps that captured almost nothing.
    if (!uri || durationMs < 700) return;
    setSending(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const ext = (uri.split('.').pop() || 'm4a').toLowerCase();
      const mime = ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : `audio/${ext}`;
      await sendVoiceMessage({ conversationId, base64, ext, mime, durationMs });
      await reload(conversationId);
    } catch (e) {
      Alert.alert('Could not send voice note', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  if (resolving) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!conversationId) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {members.length > 0 && (
        <Pressable style={styles.peopleBar} onPress={() => setSheetOpen(true)}>
          <Ionicons name="people-outline" size={16} color={colors.brand} />
          <Text style={styles.peopleText}>
            {members.length} member{members.length === 1 ? '' : 's'}
            {onlineCount > 0 && <Text style={styles.onlineText}> · {onlineCount} online</Text>}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.subtle} />
        </Pressable>
      )}

      <ChatMembersSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        conversationId={conversationId}
        members={members}
        onlineIds={onlineIds}
        meId={meId ?? ''}
      />

      <FlatList
        ref={listRef}
        data={messages}
        style={styles.list}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item, index }) => {
          const mine = item.senderId === meId;
          const prev = index > 0 ? messages[index - 1] : null;
          // A run from the same sender, close in time, shows the header once;
          // follow-ups sit tight beneath, aligned under it via the avatar gutter.
          // A sender change or a >5-min gap starts a fresh header (with its time).
          const showHeader =
            !prev ||
            prev.senderId !== item.senderId ||
            new Date(item.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
          const meta = rosterById.get(item.senderId);
          const tint = senderTint(item.senderId);
          const role = roleLabel(meta?.role);

          const content = (
            <>
              {item.imageUrl && !item.deletedAt && (
                <Image source={{ uri: item.imageUrl }} style={styles.image} resizeMode="cover" />
              )}
              {item.audioUrl && !item.deletedAt && <VoiceNote url={item.audioUrl} mine={mine} />}
              {(item.body || item.deletedAt) && (
                <Text style={[styles.body, mine && styles.bodyMine, item.imageUrl && styles.bodyWithImage]}>
                  {item.deletedAt ? 'message deleted' : item.body}
                </Text>
              )}
            </>
          );

          const reactionRow = item.reactions.length > 0 && (
            <View style={[styles.reactions, mine ? { justifyContent: 'flex-end' } : null]}>
              {item.reactions.map((r) => (
                <Pressable
                  key={r.emoji}
                  onPress={() => void onReact(item.id, r.emoji)}
                  style={[styles.reactionChip, r.mine && styles.reactionChipMine]}
                >
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  {r.count > 1 && <Text style={styles.reactionCount}>{r.count}</Text>}
                </Pressable>
              ))}
            </View>
          );

          if (mine) {
            return (
              <Pressable onLongPress={() => !item.deletedAt && setActionTarget(item)} delayLongPress={300} style={[styles.row, styles.rowMine]}>
                <View style={styles.mineCol}>
                  {showHeader && <Text style={styles.mineTime}>{shortTime(item.createdAt)}</Text>}
                  <View style={[styles.bubble, styles.bubbleMine]}>{content}</View>
                  {reactionRow}
                </View>
              </Pressable>
            );
          }
          return (
            <Pressable onLongPress={() => !item.deletedAt && setActionTarget(item)} delayLongPress={300} style={[styles.row, styles.rowOther]}>
              <View style={styles.avatarGutter}>
                {showHeader ? (
                  <Avatar name={item.senderName} avatarUrl={meta?.avatarUrl} userId={item.senderId} size={30} />
                ) : null}
              </View>
              <View style={styles.otherCol}>
                {showHeader && (
                  <Text style={styles.identity} numberOfLines={1}>
                    <Text style={styles.identityName}>{item.senderName}</Text>
                    {meta?.company ? <Text style={styles.identityMeta}> · {meta.company}</Text> : null}
                    {role ? <Text style={styles.identityMeta}> · {role}</Text> : null}
                    <Text style={styles.identityMeta}> · {shortTime(item.createdAt)}</Text>
                  </Text>
                )}
                <View style={[styles.bubble, styles.bubbleOther, { backgroundColor: tint.bg, borderColor: tint.border }]}>
                  {content}
                </View>
                {reactionRow}
              </View>
            </Pressable>
          );
        }}
      />
      {Object.keys(typingUsers).length > 0 && (
        <View style={styles.typingRow}>
          <View style={styles.typingBubble}>
            <TypingDots color={colors.subtle} />
          </View>
          <Text style={styles.typingText} numberOfLines={1}>
            {Object.values(typingUsers).join(', ')} {Object.keys(typingUsers).length === 1 ? 'is' : 'are'} typing…
          </Text>
        </View>
      )}

      <Modal visible={!!actionTarget} transparent animationType="fade" onRequestClose={() => setActionTarget(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setActionTarget(null)}>
          <Pressable style={styles.actionCard} onPress={() => {}}>
            <View style={styles.emojiRow}>
              {EMOJIS.map((e) => (
                <Pressable
                  key={e}
                  style={styles.emojiBtn}
                  onPress={() => {
                    const t = actionTarget;
                    setActionTarget(null);
                    if (t) void onReact(t.id, e);
                  }}
                >
                  <Text style={styles.emojiBig}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={styles.actionSheetRow}
              onPress={() => {
                const t = actionTarget;
                setActionTarget(null);
                if (t) void doPin(t);
              }}
            >
              <Ionicons name="bookmark-outline" size={18} color={colors.text} />
              <Text style={styles.actionSheetText}>Pin message</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {recorderState.isRecording ? (
        <View style={styles.composer}>
          <Pressable style={styles.attach} onPress={() => void cancelRecording()}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </Pressable>
          <View style={styles.recording}>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>{fmtDuration(recorderState.durationMillis)}</Text>
            <Text style={styles.recHint}>Recording…</Text>
          </View>
          <Pressable style={styles.send} onPress={() => void stopAndSendRecording()} disabled={sending}>
            <Ionicons name="send" size={18} color={colors.onBrand} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.composer}>
          <Pressable style={styles.attach} onPress={pickPhoto} disabled={sending}>
            <Ionicons name="camera-outline" size={22} color={colors.brand} />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Write a message…"
            placeholderTextColor={colors.subtle}
            value={input}
            onChangeText={onChangeInput}
            multiline
          />
          {input.trim() ? (
            <Pressable
              style={[styles.send, sending && styles.sendDisabled]}
              onPress={submit}
              disabled={sending}
            >
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.mic} onPress={() => void startRecording()} disabled={sending}>
              <Ionicons name="mic" size={22} color={colors.brand} />
            </Pressable>
          )}
        </View>
      )}
      {/* Lifts the composer above the keyboard (open) or the gesture bar (closed). */}
      <View style={{ height: bottomSpace }} />
    </View>
  );
}

/** Three bouncing dots — the WhatsApp-style "typing…" animation. */
function TypingDots({ color }: { color: string }) {
  const dots = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;
  useEffect(() => {
    const anims = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 320, useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dots]);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {dots.map((v, i) => (
        <Animated.View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, opacity: v }} />
      ))}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    list: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.bg },
    peopleBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    peopleText: { flex: 1, fontSize: 13, fontFamily: font.bodySemi, color: c.text },
    onlineText: { color: c.success, fontFamily: font.bodySemi },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg },
    muted: { color: c.muted },
    listContent: { padding: 12, gap: 8 },
    row: { flexDirection: 'row', gap: 8 },
    rowMine: { justifyContent: 'flex-end' },
    rowOther: { justifyContent: 'flex-start', alignItems: 'flex-start' },
    avatarGutter: { width: 30 },
    otherCol: { flexShrink: 1, maxWidth: '82%', alignItems: 'flex-start' },
    mineCol: { flexShrink: 1, maxWidth: '82%', alignItems: 'flex-end' },
    mineTime: { fontSize: 11, color: c.subtle, marginBottom: 3, marginRight: 2 },
    identity: { fontSize: 11, color: c.subtle, marginBottom: 3, marginLeft: 2 },
    identityName: { fontFamily: font.bodySemi, color: c.text },
    identityMeta: { color: c.subtle },
    bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
    bubbleMine: { backgroundColor: c.brand },
    bubbleOther: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    body: { fontSize: 14, color: c.text },
    bodyMine: { color: c.onBrand },
    bodyWithImage: { marginTop: 6 },
    image: { width: 200, height: 200, borderRadius: 10, backgroundColor: c.sunk },
    reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
    reactionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 11,
      backgroundColor: c.sunk,
    },
    reactionChipMine: { backgroundColor: c.brandSoft },
    reactionEmoji: { fontSize: 13 },
    reactionCount: { fontSize: 11, color: c.subtle, fontFamily: font.bodySemi },
    typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 4 },
    typingBubble: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: 14,
      borderBottomLeftRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    typingText: { flex: 1, fontSize: 11, color: c.subtle },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    actionCard: { backgroundColor: c.surface, borderRadius: 16, padding: 10, minWidth: 260 },
    emojiRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 },
    emojiBtn: { paddingHorizontal: 8, paddingVertical: 6 },
    emojiBig: { fontSize: 28 },
    actionSheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 8,
      marginTop: 4,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    actionSheetText: { fontSize: 15, color: c.text, fontFamily: font.bodySemi },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      padding: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
    },
    attach: { alignSelf: 'center', paddingHorizontal: 4, paddingVertical: 6 },
    input: {
      flex: 1,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      fontSize: 15,
      color: c.text,
    },
    send: {
      backgroundColor: c.brand,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      alignSelf: 'center',
      justifyContent: 'center',
    },
    sendDisabled: { opacity: 0.5 },
    sendText: { color: c.onBrand, fontFamily: font.bodySemi },
    mic: { alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 8 },
    recording: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
    },
    recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
    recTime: { fontSize: 15, fontFamily: font.bodyBold, color: c.text, fontVariant: ['tabular-nums'] },
    recHint: { fontSize: 13, color: c.subtle },
  });

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A run of same-sender messages within this gap groups under one header.
const GROUP_GAP_MS = 5 * 60 * 1000;

/** Local "9:41am" — hand-rolled to avoid relying on RN's patchy Intl on Android. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}
