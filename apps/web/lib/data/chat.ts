import { createClient } from '@/lib/supabase/server';

export interface ChatMessage {
  id: string;
  seq: number;
  body: string | null;
  senderId: string;
  senderName: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  parentMessageId: string | null;
}

/** The project's group-chat conversation id — or null if the caller can't access
 *  it (RLS: contractors are excluded from project chat unless explicitly added). */
export async function getProjectConversationId(projectId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('project_id', projectId)
    .eq('type', 'project')
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** The active task-DM conversation id — null if none or the caller can't access it. */
export async function getTaskConversationId(taskId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('task_id', taskId)
    .eq('type', 'task_dm')
    .eq('status', 'active')
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Most recent messages (ascending), with sender display names resolved. */
export async function listMessages(conversationId: string, limit = 50): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select('id, seq, body, sender_id, created_at, edited_at, deleted_at, parent_message_id')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(limit);
  const rows = ((data ?? []) as {
    id: string;
    seq: number;
    body: string | null;
    sender_id: string;
    created_at: string;
    edited_at: string | null;
    deleted_at: string | null;
    parent_message_id: string | null;
  }[]).reverse();

  const names = await resolveNames(rows.map((r) => r.sender_id));
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    body: r.deleted_at ? null : r.body,
    senderId: r.sender_id,
    senderName: names.get(r.sender_id) ?? 'Member',
    createdAt: r.created_at,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
    parentMessageId: r.parent_message_id,
  }));
}

/** Highest read cursor among OTHER participants — drives the "Seen" indicator. */
export async function othersMaxReadSeq(conversationId: string, meId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('chat_read_state')
    .select('user_id, last_read_seq')
    .eq('conversation_id', conversationId);
  const rows = (data ?? []) as { user_id: string; last_read_seq: number }[];
  return rows.filter((r) => r.user_id !== meId).reduce((m, r) => Math.max(m, r.last_read_seq), 0);
}

async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  return new Map(
    ((data ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.display_name || p.email || 'Member',
    ]),
  );
}
