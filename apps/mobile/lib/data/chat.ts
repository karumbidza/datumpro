import { supabase } from '../supabase';

export interface ChatMessage {
  id: string;
  body: string | null;
  senderId: string;
  senderName: string;
  createdAt: string;
  deletedAt: string | null;
}

/** The active task-DM conversation id for a task — null if none or no access. */
export async function getTaskConversationId(taskId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('task_id', taskId)
    .eq('type', 'task_dm')
    .eq('status', 'active')
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Recent messages (ascending) with sender names. RLS scopes to participants. */
export async function listMessages(conversationId: string, limit = 50): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('messages')
    .select('id, body, sender_id, created_at, deleted_at')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(limit);
  const rows = ((data ?? []) as {
    id: string;
    body: string | null;
    sender_id: string;
    created_at: string;
    deleted_at: string | null;
  }[]).reverse();

  const names = await resolveNames(rows.map((r) => r.sender_id));
  return rows.map((r) => ({
    id: r.id,
    body: r.deleted_at ? null : r.body,
    senderId: r.sender_id,
    senderName: names.get(r.sender_id) ?? 'Member',
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }));
}

/** Post a message. RLS (can_access_chat) governs who may send. */
export async function sendMessage(conversationId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body: trimmed });
  if (error) throw new Error(error.message);
}

async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  return new Map(
    ((data ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.display_name || p.email || 'Member',
    ]),
  );
}
