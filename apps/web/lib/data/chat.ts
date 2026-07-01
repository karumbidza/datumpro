import { createClient } from '@/lib/supabase/server';

export interface MessageReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document';

export interface ChatAttachment {
  id: string;
  kind: AttachmentKind;
  url: string | null; // signed URL (short-lived); null if signing failed
  mime: string | null;
  filename: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

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
  reactions: MessageReaction[];
  attachments: ChatAttachment[];
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

/** Most recent messages (ascending), with sender names + aggregated reactions. */
export async function listMessages(
  conversationId: string,
  meId: string,
  limit = 50,
): Promise<ChatMessage[]> {
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

  const ids = rows.map((r) => r.id);
  const [names, reactions, attachments] = await Promise.all([
    resolveNames(rows.map((r) => r.sender_id)),
    aggregateReactions(conversationId, ids, meId),
    loadAttachments(ids),
  ]);

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
    reactions: reactions.get(r.id) ?? [],
    attachments: r.deleted_at ? [] : attachments.get(r.id) ?? [],
  }));
}

/** Attachments for the loaded messages, with freshly signed URLs (one batched
 *  createSignedUrls call). Storage SELECT RLS gates signing — a caller who can't
 *  reach the conversation gets no URL. */
async function loadAttachments(messageIds: string[]): Promise<Map<string, ChatAttachment[]>> {
  const out = new Map<string, ChatAttachment[]>();
  if (messageIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_attachments')
    .select('id, message_id, kind, storage_path, mime, filename, size_bytes, duration_seconds, width, height')
    .in('message_id', messageIds)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    message_id: string;
    kind: string;
    storage_path: string;
    mime: string | null;
    filename: string | null;
    size_bytes: number | null;
    duration_seconds: number | null;
    width: number | null;
    height: number | null;
  }[];
  if (rows.length === 0) return out;

  const paths = [...new Set(rows.map((r) => r.storage_path))];
  const { data: signed } = await supabase.storage.from('chat-media').createSignedUrls(paths, 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  for (const r of rows) {
    const att: ChatAttachment = {
      id: r.id,
      kind: (['image', 'video', 'audio', 'document'].includes(r.kind) ? r.kind : 'document') as AttachmentKind,
      url: urlByPath.get(r.storage_path) ?? null,
      mime: r.mime,
      filename: r.filename,
      sizeBytes: r.size_bytes,
      durationSeconds: r.duration_seconds,
      width: r.width,
      height: r.height,
    };
    const list = out.get(r.message_id) ?? [];
    list.push(att);
    out.set(r.message_id, list);
  }
  return out;
}

export interface ChatSearchResult {
  id: string;
  seq: number;
  body: string;
  senderId: string;
  senderName: string;
  createdAt: string;
}

/** Full-text search within one conversation. RLS scopes the query to messages the
 *  caller may read; `websearch` parsing makes arbitrary user input safe (no tsquery
 *  syntax errors, no injection). Matches the generated column's 'simple' config. */
export async function searchMessages(
  conversationId: string,
  query: string,
  limit = 30,
): Promise<ChatSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select('id, seq, body, sender_id, created_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .textSearch('search_tsv', q, { type: 'websearch', config: 'simple' })
    .order('seq', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as {
    id: string;
    seq: number;
    body: string | null;
    sender_id: string;
    created_at: string;
  }[];
  if (rows.length === 0) return [];
  const names = await resolveNames(rows.map((r) => r.sender_id));
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    body: r.body ?? '',
    senderId: r.sender_id,
    senderName: names.get(r.sender_id) ?? 'Member',
    createdAt: r.created_at,
  }));
}

async function aggregateReactions(
  conversationId: string,
  messageIds: string[],
  meId: string,
): Promise<Map<string, MessageReaction[]>> {
  const out = new Map<string, MessageReaction[]>();
  if (messageIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_reactions')
    .select('message_id, emoji, user_id')
    .eq('conversation_id', conversationId);
  const rows = (data ?? []) as { message_id: string; emoji: string; user_id: string }[];
  const byMsg = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const r of rows) {
    const m = byMsg.get(r.message_id) ?? new Map();
    const cur = m.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === meId) cur.mine = true;
    m.set(r.emoji, cur);
    byMsg.set(r.message_id, m);
  }
  for (const [mid, emap] of byMsg) {
    out.set(
      mid,
      [...emap.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
    );
  }
  return out;
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
