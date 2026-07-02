import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/auth';
import {
  listMessages,
  sendMessage,
  sendPhotoMessage,
  markConversationRead,
  type ChatMessage,
} from '../lib/data/chat';

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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const reload = useCallback(async (id: string) => {
    setMessages(await listMessages(id));
    // Opening / viewing the thread clears its unread state.
    void markConversationRead(id);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      await reload(conversationId);
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase.channel(`chat:${conversationId}`, {
        config: { private: true, broadcast: { self: false } },
      });
      channel
        .on('broadcast', { event: 'message' }, () => active && void reload(conversationId))
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [conversationId, reload]);

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
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.senderId === meId;
          return (
            <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                {!mine && <Text style={styles.sender}>{item.senderName}</Text>}
                {item.imageUrl && !item.deletedAt && (
                  <Image source={{ uri: item.imageUrl }} style={styles.image} resizeMode="cover" />
                )}
                {(item.body || item.deletedAt) && (
                  <Text style={[styles.body, mine && styles.bodyMine, item.imageUrl && styles.bodyWithImage]}>
                    {item.deletedAt ? 'message deleted' : item.body}
                  </Text>
                )}
              </View>
            </View>
          );
        }}
      />
      <View style={styles.composer}>
        <Pressable style={styles.attach} onPress={pickPhoto} disabled={sending}>
          <Ionicons name="camera-outline" size={22} color="#4f46e5" />
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="Write a message…"
          placeholderTextColor="#a1a1aa"
          value={input}
          onChangeText={setInput}
          multiline
        />
        <Pressable
          style={[styles.send, (!input.trim() || sending) && styles.sendDisabled]}
          onPress={submit}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fafafa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafafa' },
  muted: { color: '#71717a' },
  listContent: { padding: 12, gap: 8 },
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: '#4f46e5' },
  bubbleOther: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee' },
  sender: { fontSize: 11, color: '#71717a', marginBottom: 2, fontWeight: '600' },
  body: { fontSize: 14, color: '#18181b' },
  bodyMine: { color: '#fff' },
  bodyWithImage: { marginTop: 6 },
  image: { width: 200, height: 200, borderRadius: 10, backgroundColor: '#f4f4f5' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#e4e4e7',
    backgroundColor: '#fff',
  },
  attach: { alignSelf: 'center', paddingHorizontal: 4, paddingVertical: 6 },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    color: '#18181b',
  },
  send: { backgroundColor: '#4f46e5', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600' },
});
