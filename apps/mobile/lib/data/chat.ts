import { decode } from 'base64-arraybuffer';
import { supabase, currentUser} from '../supabase';
import { assertUploadSize, MAX_CHAT_MEDIA_BYTES } from '../upload-limits';

const CHAT_BUCKET = 'chat-media';

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ChatMessage {
  id: string;
  body: string | null;
  senderId: string;
  senderName: string;
  createdAt: string;
  deletedAt: string | null;
  imageUrl: string | null; // first image attachment, signed
  audioUrl: string | null; // first audio (voice note) attachment, signed
  reactions: ReactionSummary[]; // aggregated emoji reactions
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

  const [names, media, reactions] = await Promise.all([
    resolveNames(rows.map((r) => r.sender_id)),
    resolveAttachments(rows.map((r) => r.id)),
    resolveReactions(rows.map((r) => r.id)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    body: r.deleted_at ? null : r.body,
    senderId: r.sender_id,
    senderName: names.get(r.sender_id) ?? 'Member',
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
    imageUrl: r.deleted_at ? null : media.images.get(r.id) ?? null,
    audioUrl: r.deleted_at ? null : media.audios.get(r.id) ?? null,
    reactions: r.deleted_at ? [] : reactions.get(r.id) ?? [],
  }));
}

/** message_id → aggregated emoji reactions (count + whether the current user
 *  reacted). One query covers all listed messages. */
async function resolveReactions(messageIds: string[]): Promise<Map<string, ReactionSummary[]>> {
  const out = new Map<string, ReactionSummary[]>();
  const ids = [...new Set(messageIds)];
  if (ids.length === 0) return out;
  const user = await currentUser();
  const me = user?.id;
  const { data } = await supabase
    .from('message_reactions')
    .select('message_id, emoji, user_id')
    .in('message_id', ids);
  const rows = (data ?? []) as { message_id: string; emoji: string; user_id: string }[];
  const byMsg = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const r of rows) {
    let emap = byMsg.get(r.message_id);
    if (!emap) {
      emap = new Map();
      byMsg.set(r.message_id, emap);
    }
    const e = emap.get(r.emoji) ?? { count: 0, mine: false };
    e.count += 1;
    if (me && r.user_id === me) e.mine = true;
    emap.set(r.emoji, e);
  }
  for (const [mid, emap] of byMsg) {
    out.set(
      mid,
      [...emap.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
    );
  }
  return out;
}

/** Toggle one emoji reaction for the current user (insert, or delete if it exists).
 *  Scope columns are filled by a trigger; a duplicate insert on a race is a no-op. */
export async function toggleReaction(messageId: string, emoji: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const { data: existing } = await supabase
    .from('message_reactions')
    .select('id')
    .eq('message_id', messageId)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase.from('message_reactions').delete().eq('id', (existing as { id: string }).id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('message_reactions').insert({ message_id: messageId, user_id: user.id, emoji });
    if (error && error.code !== '23505') throw new Error(error.message);
  }
}

/** Post a text message. RLS (can_access_chat) governs who may send. */
export async function sendMessage(conversationId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const user = await currentUser();
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
  const user = await currentUser();
  if (!user) return;

  const { data: conv } = await supabase
    .from('conversations')
    .select('org_id, project_id')
    .eq('id', params.conversationId)
    .maybeSingle();
  const c = conv as { org_id: string; project_id: string } | null;
  if (!c) throw new Error('Conversation not found');
  assertUploadSize(params.base64, MAX_CHAT_MEDIA_BYTES, 'This photo');

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

/** Post a voice note. Same path/RLS as photos, but the attachment is kind 'audio'
 *  so web and mobile both render it as a playable clip. */
export async function sendVoiceMessage(params: {
  conversationId: string;
  base64: string;
  ext: string;
  mime: string;
  durationMs?: number | null;
  sizeBytes?: number | null;
}): Promise<void> {
  const user = await currentUser();
  if (!user) return;

  const { data: conv } = await supabase
    .from('conversations')
    .select('org_id, project_id')
    .eq('id', params.conversationId)
    .maybeSingle();
  const c = conv as { org_id: string; project_id: string } | null;
  if (!c) throw new Error('Conversation not found');
  assertUploadSize(params.base64, MAX_CHAT_MEDIA_BYTES, 'This voice note');

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
    kind: 'audio',
    storage_path: path,
    mime: params.mime,
    size_bytes: params.sizeBytes ?? null,
    duration_seconds: params.durationMs != null ? Math.round(params.durationMs / 100) / 10 : null,
  });
  if (attErr) throw new Error(attErr.message);
}

/** message_id → first image / audio attachment signed URL (chat-media is private).
 *  One query + one batch of signed URLs covers both kinds. Audio here surfaces
 *  voice notes sent from either web or mobile, so they play cross-platform. */
async function resolveAttachments(
  messageIds: string[],
): Promise<{ images: Map<string, string>; audios: Map<string, string> }> {
  const ids = [...new Set(messageIds)];
  const images = new Map<string, string>();
  const audios = new Map<string, string>();
  if (ids.length === 0) return { images, audios };
  const { data } = await supabase
    .from('message_attachments')
    .select('message_id, storage_path, kind')
    .in('message_id', ids)
    .in('kind', ['image', 'audio']);
  const atts = (data ?? []) as { message_id: string; storage_path: string; kind: string }[];
  if (atts.length === 0) return { images, audios };

  const { data: signed } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrls(atts.map((a) => a.storage_path), 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  for (const a of atts) {
    const u = urlByPath.get(a.storage_path);
    if (!u) continue;
    const target = a.kind === 'audio' ? audios : images;
    if (!target.has(a.message_id)) target.set(a.message_id, u);
  }
  return { images, audios };
}

/** A file shared in the conversation (signed for viewing) — the rail Files tab. */
export interface ConversationFile {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  url: string | null;
  mime: string | null;
  filename: string | null;
  sizeBytes: number | null;
  createdAt: string;
  senderName: string | null;
}

/** Every attachment shared in a conversation (newest first), signed for viewing.
 *  Attachments on deleted messages are excluded; RLS scopes to chat members. */
export async function listConversationFiles(conversationId: string): Promise<ConversationFile[]> {
  const { data } = await supabase
    .from('message_attachments')
    .select('id, kind, storage_path, mime, filename, size_bytes, created_at, messages(sender_id, deleted_at)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });
  type Row = {
    id: string;
    kind: string;
    storage_path: string;
    mime: string | null;
    filename: string | null;
    size_bytes: number | null;
    created_at: string;
    messages:
      | { sender_id: string; deleted_at: string | null }
      | { sender_id: string; deleted_at: string | null }[]
      | null;
  };
  const msg = (m: Row['messages']) => (Array.isArray(m) ? m[0] : m) ?? null;
  const rows = ((data ?? []) as Row[]).filter((r) => {
    const m = msg(r.messages);
    return m && !m.deleted_at;
  });
  if (rows.length === 0) return [];

  const paths = [...new Set(rows.map((r) => r.storage_path))];
  const { data: signed } = await supabase.storage.from(CHAT_BUCKET).createSignedUrls(paths, 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  const names = await resolveNames([...new Set(rows.map((r) => msg(r.messages)!.sender_id))]);

  return rows.map((r) => ({
    id: r.id,
    kind: (['image', 'video', 'audio', 'document'].includes(r.kind) ? r.kind : 'document') as ConversationFile['kind'],
    url: urlByPath.get(r.storage_path) ?? null,
    mime: r.mime,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
    senderName: names.get(msg(r.messages)!.sender_id) ?? null,
  }));
}

/** The conversation's About Topic — the rail About tab. */
export interface ChatAbout {
  topic: string | null;
  description: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string | null;
}

export async function getConversationAbout(conversationId: string): Promise<ChatAbout> {
  const { data } = await supabase
    .from('conversations')
    .select('topic, description, note, created_by, created_at')
    .eq('id', conversationId)
    .maybeSingle();
  const c = data as {
    topic: string | null;
    description: string | null;
    note: string | null;
    created_by: string | null;
    created_at: string | null;
  } | null;
  if (!c) return { topic: null, description: null, note: null, createdByName: null, createdAt: null };
  const names = c.created_by ? await resolveNames([c.created_by]) : new Map<string, string>();
  return {
    topic: c.topic,
    description: c.description,
    note: c.note,
    createdByName: c.created_by ? names.get(c.created_by) ?? null : null,
    createdAt: c.created_at,
  };
}

/** A pinned message — the rail Pinned tab. */
export interface PinnedMessage {
  pinId: string;
  messageId: string;
  body: string | null;
  senderName: string | null;
  createdAt: string;
}

/** Messages pinned in a conversation (newest pin first). Pins on deleted messages
 *  are dropped; RLS scopes to chat members. */
export async function listPinnedMessages(conversationId: string): Promise<PinnedMessage[]> {
  const { data } = await supabase
    .from('message_pins')
    .select('id, message_id, created_at, messages(body, sender_id, deleted_at)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });
  type Row = {
    id: string;
    message_id: string;
    created_at: string;
    messages:
      | { body: string | null; sender_id: string; deleted_at: string | null }
      | { body: string | null; sender_id: string; deleted_at: string | null }[]
      | null;
  };
  const msg = (m: Row['messages']) => (Array.isArray(m) ? m[0] : m) ?? null;
  const rows = ((data ?? []) as Row[]).filter((r) => {
    const m = msg(r.messages);
    return m && !m.deleted_at;
  });
  if (rows.length === 0) return [];
  const names = await resolveNames([...new Set(rows.map((r) => msg(r.messages)!.sender_id))]);
  return rows.map((r) => ({
    pinId: r.id,
    messageId: r.message_id,
    body: msg(r.messages)!.body,
    senderName: names.get(msg(r.messages)!.sender_id) ?? null,
    createdAt: r.created_at,
  }));
}

/** Pin a message (any conversation member). Scope columns are filled by a trigger;
 *  a duplicate pin is treated as a no-op. */
export async function pinMessage(messageId: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const { error } = await supabase.from('message_pins').insert({ message_id: messageId, pinned_by: user.id });
  // Unique-violation = already pinned → treat as success.
  if (error && error.code !== '23505') throw new Error(error.message);
}

/** Unpin a message (the pinner or a manager, enforced by RLS). */
export async function unpinMessage(messageId: string): Promise<void> {
  const { error } = await supabase.from('message_pins').delete().eq('message_id', messageId);
  if (error) throw new Error(error.message);
}

/** Unread task-discussion counts, keyed by task id — for a badge on task rows.
 *  Only tasks with unread messages are included. */
export async function taskUnreadCounts(taskIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const user = await currentUser();
  const me = user?.id;
  if (!me || taskIds.length === 0) return map;

  const { data: convRows } = await supabase
    .from('conversations')
    .select('id, task_id')
    .eq('type', 'task_dm')
    .in('task_id', taskIds);
  const convs = (convRows ?? []) as { id: string; task_id: string }[];
  if (convs.length === 0) return map;
  const convIds = convs.map((c) => c.id);

  const [{ data: reads }, { data: msgs }] = await Promise.all([
    supabase.from('chat_read_state').select('conversation_id, last_read_seq').eq('user_id', me).in('conversation_id', convIds),
    supabase.from('messages').select('conversation_id, seq, sender_id').in('conversation_id', convIds),
  ]);
  const lastRead = new Map<string, number>();
  for (const r of (reads ?? []) as { conversation_id: string; last_read_seq: number }[]) {
    lastRead.set(r.conversation_id, r.last_read_seq);
  }
  const byConv = new Map<string, number>();
  for (const m of (msgs ?? []) as { conversation_id: string; seq: number; sender_id: string }[]) {
    if (m.sender_id === me) continue;
    if (m.seq > (lastRead.get(m.conversation_id) ?? 0)) {
      byConv.set(m.conversation_id, (byConv.get(m.conversation_id) ?? 0) + 1);
    }
  }
  for (const c of convs) {
    const u = byConv.get(c.id) ?? 0;
    if (u > 0) map.set(c.task_id, u);
  }
  return map;
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
  const user = await currentUser();
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
  const user = await currentUser();
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
