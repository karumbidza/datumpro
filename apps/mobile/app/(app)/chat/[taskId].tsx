import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { useSession } from '../../../lib/auth';
import { getTaskConversationId, listMessages, sendMessage, type ChatMessage } from '../../../lib/data/chat';

export default function TaskChat() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { session } = useSession();
  const meId = session?.user.id;

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const reload = useCallback(async (id: string) => {
    const msgs = await listMessages(id);
    setMessages(msgs);
  }, []);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const id = await getTaskConversationId(String(taskId));
      if (!active) return;
      setConversationId(id);
      if (!id) {
        setLoading(false);
        return;
      }
      await reload(id);
      setLoading(false);

      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase.channel(`chat:${id}`, {
        config: { private: true, broadcast: { self: false } },
      });
      channel.on('broadcast', { event: 'message' }, () => active && void reload(id)).subscribe();
    })();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [taskId, reload]);

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

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen options={{ title: 'Task discussion' }} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : !conversationId ? (
        <View style={styles.center}>
          <Text style={styles.muted}>No discussion for this task yet.</Text>
        </View>
      ) : (
        <>
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
                    <Text style={[styles.body, mine && styles.bodyMine]}>
                      {item.deletedAt ? 'message deleted' : item.body}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
          <View style={styles.composer}>
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
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fafafa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#e4e4e7',
    backgroundColor: '#fff',
  },
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
