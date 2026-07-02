import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabase';

const CHAT_BUCKET = 'chat-media';

export interface ChatMessage {
  id: string;
  body: string | null;
  senderId: string;
  senderName: string;
  createdAt: string;
  deletedAt: string | null;
  imageUrl: string | null; // first image attachment, signed
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

/** The project's team channel conversation id — null if not accessible.
 *  Contractors are excluded from project chat by RLS, so this returns null for
 *  them. One 'project' conversation exists per project (auto-created on insert). */
export async function getProjectConversationId(projectId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('project_id', projectId)
    .eq('type', 'project')
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

  const [names, images] = await Promise.all([
    resolveNames(rows.map((r) => r.sender_id)),
    resolveImages(rows.map((r) => r.id)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    body: r.deleted_at ? null : r.body,
    senderId: r.sender_id,
    senderName: names.get(r.sender_id) ?? 'Member',
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
    imageUrl: r.deleted_at ? null : images.get(r.id) ?? null,
  }));
}

/** Post a text message. RLS (can_access_chat) governs who may send. */
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

/** Post a photo message. Uploads to the conversation-keyed chat-media path (the
 *  storage RLS checks folder[4] = conversation id), inserts the message, then the
 *  attachment; a trigger denormalises the attachment for RLS. */
export async function sendPhotoMessage(params: {
  conversationId: string;
  base64: string;
  ext: string;
  mime: string;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: conv } = await supabase
    .from('conversations')
    .select('org_id, project_id')
    .eq('id', params.conversationId)
    .maybeSingle();
  const c = conv as { org_id: string; project_id: string } | null;
  if (!c) throw new Error('Conversation not found');

  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${params.ext}`;
  const path = `${c.org_id}/${c.project_id}/chat/${params.conversationId}/${name}`;
  const { error: upErr } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(path, decode(params.base64), { contentType: params.mime, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { data: msg, error: msgErr } = await supabase
    .from('messages')
    .insert({ conversation_id: params.conversationId, sender_id: user.id, body: null })
    .select('id')
    .single();
  if (msgErr) throw new Error(msgErr.message);

  const { error: attErr } = await supabase.from('message_attachments').insert({
    message_id: (msg as { id: string }).id,
    kind: 'image',
    storage_path: path,
    mime: params.mime,
    size_bytes: params.sizeBytes ?? null,
    width: params.width ?? null,
    height: params.height ?? null,
  });
  if (attErr) throw new Error(attErr.message);
}

/** message_id → first image attachment's signed URL (chat-media is private). */
async function resolveImages(messageIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(messageIds)];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await supabase
    .from('message_attachments')
    .select('message_id, storage_path')
    .in('message_id', ids)
    .eq('kind', 'image');
  const atts = (data ?? []) as { message_id: string; storage_path: string }[];
  if (atts.length === 0) return out;

  const { data: signed } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrls(atts.map((a) => a.storage_path), 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  for (const a of atts) {
    const u = urlByPath.get(a.storage_path);
    if (u && !out.has(a.message_id)) out.set(a.message_id, u);
  }
  return out;
}

export interface InboxItem {
  conversationId: string;
  type: 'project' | 'task_dm';
  title: string;
  subtitle: string;
  taskId: string | null;
  projectId: string;
  lastBody: string | null; // '📷 Photo' for image-only messages
  lastAt: string | null;
  unread: number;
}

/** Every conversation the user can see, newest-active first, each with a last-
 *  message preview and unread count — the Messages inbox. One bounded messages
 *  fetch drives previews + unread in memory (no per-conversation round trips). */
export async function listInbox(): Promise<InboxItem[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user?.id;
  if (!me) return [];

  const { data: convRows } = await supabase
    .from('conversations')
    .select('id, type, task_id, project_id')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(80);
  const convs = (convRows ?? []) as {
    id: string;
    type: 'project' | 'task_dm';
    task_id: string | null;
    project_id: string;
  }[];
  if (convs.length === 0) return [];
  const convIds = convs.map((c) => c.id);

  const taskIds = [...new Set(convs.map((c) => c.task_id).filter(Boolean))] as string[];
  const projIds = [...new Set(convs.map((c) => c.project_id))];
  const [tasksRes, projsRes, readRes, msgRes] = await Promise.all([
    taskIds.length
      ? supabase.from('tasks').select('id, title').in('id', taskIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    supabase.from('projects').select('id, name').in('id', projIds),
    supabase.from('chat_read_state').select('conversation_id, last_read_seq').eq('user_id', me),
    supabase
      .from('messages')
      .select('conversation_id, body, created_at, seq, sender_id')
      .in('conversation_id', convIds)
      .order('seq', { ascending: false })
      .limit(400),
  ]);

  const taskName = new Map(((tasksRes.data ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]));
  const projName = new Map(((projsRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const lastRead = new Map(
    ((readRes.data ?? []) as { conversation_id: string; last_read_seq: number }[]).map((r) => [
      r.conversation_id,
      r.last_read_seq,
    ]),
  );

  const msgs = (msgRes.data ?? []) as {
    conversation_id: string;
    body: string | null;
    created_at: string;
    seq: number;
    sender_id: string;
  }[];
  const latest = new Map<string, { body: string | null; created_at: string }>();
  const unread = new Map<string, number>();
  for (const m of msgs) {
    // rows are seq-desc, so the first seen per conversation is the latest
    if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, { body: m.body, created_at: m.created_at });
    if (m.seq > (lastRead.get(m.conversation_id) ?? 0) && m.sender_id !== me) {
      unread.set(m.conversation_id, (unread.get(m.conversation_id) ?? 0) + 1);
    }
  }

  const items: InboxItem[] = convs.map((c) => {
    const lm = latest.get(c.id) ?? null;
    const pName = projName.get(c.project_id) ?? 'Project';
    return {
      conversationId: c.id,
      type: c.type,
      title: c.type === 'task_dm' ? (c.task_id ? taskName.get(c.task_id) ?? 'Task' : 'Task') : pName,
      subtitle: c.type === 'task_dm' ? `${pName} · Task discussion` : 'Team channel',
      taskId: c.task_id,
      projectId: c.project_id,
      lastBody: lm ? lm.body ?? '📷 Photo' : null,
      lastAt: lm?.created_at ?? null,
      unread: unread.get(c.id) ?? 0,
    };
  });
  items.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  return items;
}

/** Unread messages in a conversation for the current user: those with a higher
 *  seq than my read cursor, sent by someone else. */
export async function getUnreadCount(conversationId: string): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user?.id;
  if (!me) return 0;

  const { data: rs } = await supabase
    .from('chat_read_state')
    .select('last_read_seq')
    .eq('conversation_id', conversationId)
    .eq('user_id', me)
    .maybeSingle();
  const lastRead = (rs as { last_read_seq: number } | null)?.last_read_seq ?? 0;

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .gt('seq', lastRead)
    .neq('sender_id', me);
  return count ?? 0;
}

/** Mark everything in the conversation read up to its latest message. */
export async function markConversationRead(conversationId: string): Promise<void> {
  const { data } = await supabase
    .from('messages')
    .select('seq')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  const maxSeq = (data as { seq: number } | null)?.seq;
  if (!maxSeq) return;
  await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
    p_upto_seq: maxSeq,
  });
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
