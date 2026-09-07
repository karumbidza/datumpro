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
  /** Site-photo evidence metadata, when the sender's device provided it. */
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
}

export type LinkTargetType = 'task' | 'snag' | 'rfi' | 'payment' | 'drawing';

/** A work-item reference chip on a message. Label and status are resolved live
 *  from the target row at read time — never snapshotted. */
export interface MessageLink {
  id: string;
  targetType: LinkTargetType;
  targetId: string;
  label: string;
  status: string | null;
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
  links: MessageLink[];
  /** User ids @-mentioned in this message (drives the mentioned-row tint). */
  mentionedUserIds: string[];
  /** Replies threaded under this message (0 for thread replies themselves). */
  replyCount: number;
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

const MESSAGE_COLS =
  'id, seq, body, sender_id, created_at, edited_at, deleted_at, parent_message_id';

interface MessageRow {
  id: string;
  seq: number;
  body: string | null;
  sender_id: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  parent_message_id: string | null;
}

/** Resolve names + reactions + attachments for a set of rows (one batched call
 *  each) and shape them into ChatMessages. Shared by every list/fetch path. */
async function hydrate(rows: MessageRow[], meId: string): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [names, reactions, attachments, links, mentions, replyCounts] = await Promise.all([
    resolveNames(rows.map((r) => r.sender_id)),
    aggregateReactions(ids, meId),
    loadAttachments(ids),
    loadLinks(ids),
    loadMentions(ids),
    loadReplyCounts(ids),
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
    links: r.deleted_at ? [] : links.get(r.id) ?? [],
    mentionedUserIds: mentions.get(r.id) ?? [],
    replyCount: replyCounts.get(r.id) ?? 0,
  }));
}

/** Replies-per-parent for the loaded window (deleted replies still count as the
 *  thread exists; their bodies render as "message deleted" inside it). */
async function loadReplyCounts(messageIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (messageIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select('parent_message_id')
    .in('parent_message_id', messageIds);
  for (const r of (data ?? []) as { parent_message_id: string | null }[]) {
    if (r.parent_message_id) out.set(r.parent_message_id, (out.get(r.parent_message_id) ?? 0) + 1);
  }
  return out;
}

async function loadMentions(messageIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (messageIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_mentions')
    .select('message_id, mentioned_user_id')
    .in('message_id', messageIds);
  for (const r of (data ?? []) as { message_id: string; mentioned_user_id: string }[]) {
    const list = out.get(r.message_id) ?? [];
    list.push(r.mentioned_user_id);
    out.set(r.message_id, list);
  }
  return out;
}

/** Load link rows for a message window and resolve each target's label + live
 *  status with one batched query per target type. A target the caller can't see
 *  (RLS) or that was deleted is dropped from the chip row. */
async function loadLinks(messageIds: string[]): Promise<Map<string, MessageLink[]>> {
  const out = new Map<string, MessageLink[]>();
  if (messageIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_links')
    .select('id, message_id, target_type, target_id')
    .in('message_id', messageIds)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as { id: string; message_id: string; target_type: LinkTargetType; target_id: string }[];
  if (rows.length === 0) return out;

  const byType = new Map<LinkTargetType, string[]>();
  for (const r of rows) {
    const list = byType.get(r.target_type) ?? [];
    list.push(r.target_id);
    byType.set(r.target_type, list);
  }

  const resolved = new Map<string, { label: string; status: string | null }>();
  const key = (t: string, id: string) => `${t}:${id}`;
  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const unique = [...new Set(ids)];
      if (type === 'task') {
        const { data: d } = await supabase.from('tasks').select('id, title, status').in('id', unique);
        for (const t of (d ?? []) as { id: string; title: string; status: string }[])
          resolved.set(key(type, t.id), { label: t.title, status: t.status });
      } else if (type === 'snag') {
        const { data: d } = await supabase.from('snags').select('id, number, title, status').in('id', unique);
        for (const t of (d ?? []) as { id: string; number: number; title: string; status: string }[])
          resolved.set(key(type, t.id), { label: `Snag ${t.number} · ${t.title}`, status: t.status });
      } else if (type === 'rfi') {
        const { data: d } = await supabase.from('rfis').select('id, number, subject, status').in('id', unique);
        for (const t of (d ?? []) as { id: string; number: number; subject: string; status: string }[])
          resolved.set(key(type, t.id), { label: `RFI ${t.number} · ${t.subject}`, status: t.status });
      } else if (type === 'payment') {
        const { data: d } = await supabase
          .from('contractor_payment_requests')
          .select('id, title, status')
          .in('id', unique);
        for (const t of (d ?? []) as { id: string; title: string; status: string }[])
          resolved.set(key(type, t.id), { label: t.title, status: t.status });
      } else if (type === 'drawing') {
        const { data: d } = await supabase.from('drawings').select('id, number, title').in('id', unique);
        for (const t of (d ?? []) as { id: string; number: string; title: string }[])
          resolved.set(key(type, t.id), { label: `${t.number} · ${t.title}`, status: null });
      }
    }),
  );

  for (const r of rows) {
    const t = resolved.get(key(r.target_type, r.target_id));
    if (!t) continue; // target deleted or not visible to this caller
    const list = out.get(r.message_id) ?? [];
    list.push({ id: r.id, targetType: r.target_type, targetId: r.target_id, label: t.label, status: t.status });
    out.set(r.message_id, list);
  }
  return out;
}

/** The caller's own read cursor — drives the unread "New" divider. */
export async function myReadSeq(conversationId: string, meId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('chat_read_state')
    .select('last_read_seq')
    .eq('conversation_id', conversationId)
    .eq('user_id', meId)
    .maybeSingle();
  return (data as { last_read_seq: number } | null)?.last_read_seq ?? 0;
}

/** All replies under one parent message (ascending) — the rail thread view. */
export async function listThreadMessages(
  conversationId: string,
  meId: string,
  parentMessageId: string,
): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select(MESSAGE_COLS)
    .eq('conversation_id', conversationId)
    .eq('parent_message_id', parentMessageId)
    .order('seq', { ascending: true })
    .limit(200);
  return hydrate((data ?? []) as MessageRow[], meId);
}

/** Typeahead over the project's linkable work items ("#" in the composer).
 *  One small ilike query per register; RLS scopes each to what the caller may
 *  see, so a contractor's results are already filtered. */
export interface LinkTargetOption {
  targetType: LinkTargetType;
  targetId: string;
  label: string;
  status: string | null;
}

export async function searchLinkTargets(projectId: string, query: string): Promise<LinkTargetOption[]> {
  const q = query.trim();
  const supabase = await createClient();
  const like = q ? `%${q}%` : '%';
  const [tasks, snags, rfis, payments, drawings] = await Promise.all([
    supabase.from('tasks').select('id, title, status').eq('project_id', projectId).ilike('title', like).limit(5),
    supabase.from('snags').select('id, number, title, status').eq('project_id', projectId).ilike('title', like).limit(4),
    supabase.from('rfis').select('id, number, subject, status').eq('project_id', projectId).ilike('subject', like).limit(4),
    supabase
      .from('contractor_payment_requests')
      .select('id, title, status')
      .eq('project_id', projectId)
      .ilike('title', like)
      .limit(4),
    supabase.from('drawings').select('id, number, title').eq('project_id', projectId).ilike('title', like).limit(4),
  ]);
  const out: LinkTargetOption[] = [];
  for (const t of (tasks.data ?? []) as { id: string; title: string; status: string }[])
    out.push({ targetType: 'task', targetId: t.id, label: t.title, status: t.status });
  for (const s of (snags.data ?? []) as { id: string; number: number; title: string; status: string }[])
    out.push({ targetType: 'snag', targetId: s.id, label: `Snag ${s.number} · ${s.title}`, status: s.status });
  for (const r of (rfis.data ?? []) as { id: string; number: number; subject: string; status: string }[])
    out.push({ targetType: 'rfi', targetId: r.id, label: `RFI ${r.number} · ${r.subject}`, status: r.status });
  for (const p of (payments.data ?? []) as { id: string; title: string; status: string }[])
    out.push({ targetType: 'payment', targetId: p.id, label: p.title, status: p.status });
  for (const d of (drawings.data ?? []) as { id: string; number: string; title: string }[])
    out.push({ targetType: 'drawing', targetId: d.id, label: `${d.number} · ${d.title}`, status: null });
  return out.slice(0, 12);
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
    .select(MESSAGE_COLS)
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(limit);
  const rows = ((data ?? []) as MessageRow[]).reverse();
  return hydrate(rows, meId);
}

/** A page of OLDER messages (seq < beforeSeq), ascending — for "load earlier". */
export async function listMessagesBefore(
  conversationId: string,
  meId: string,
  beforeSeq: number,
  limit = 50,
): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select(MESSAGE_COLS)
    .eq('conversation_id', conversationId)
    .lt('seq', beforeSeq)
    .order('seq', { ascending: false })
    .limit(limit);
  const rows = ((data ?? []) as MessageRow[]).reverse();
  return hydrate(rows, meId);
}

/** Only messages NEWER than sinceSeq (ascending) — the reconnect / new-message
 *  delta. Bounded so a long offline gap still returns a sane payload. */
export async function listMessagesSince(
  conversationId: string,
  meId: string,
  sinceSeq: number,
  limit = 200,
): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select(MESSAGE_COLS)
    .eq('conversation_id', conversationId)
    .gt('seq', sinceSeq)
    .order('seq', { ascending: true })
    .limit(limit);
  return hydrate((data ?? []) as MessageRow[], meId);
}

/** A single message, freshly hydrated — for edit / delete / reaction updates to a
 *  row that is already on screen. Null if it no longer resolves. */
export async function getMessage(
  conversationId: string,
  meId: string,
  messageId: string,
): Promise<ChatMessage | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select(MESSAGE_COLS)
    .eq('conversation_id', conversationId)
    .eq('id', messageId)
    .maybeSingle();
  if (!data) return null;
  const [m] = await hydrate([data as MessageRow], meId);
  return m ?? null;
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
    .select('id, message_id, kind, storage_path, mime, filename, size_bytes, duration_seconds, width, height, lat, lng, taken_at')
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
    lat: number | null;
    lng: number | null;
    taken_at: string | null;
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
      lat: r.lat,
      lng: r.lng,
      takenAt: r.taken_at,
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
  messageIds: string[],
  meId: string,
): Promise<Map<string, MessageReaction[]>> {
  const out = new Map<string, MessageReaction[]>();
  if (messageIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_reactions')
    .select('message_id, emoji, user_id')
    .in('message_id', messageIds);
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

/** One shared file in a conversation, for the right-rail Files/Media view. */
export interface ConversationFile {
  id: string;
  kind: AttachmentKind;
  url: string | null;
  mime: string | null;
  filename: string | null;
  sizeBytes: number | null;
  createdAt: string;
  senderName: string | null;
}

/** Every attachment shared in a conversation (newest first), signed for viewing.
 *  Attachments on deleted messages are excluded. RLS scopes to chat members. */
export async function listConversationAttachments(conversationId: string): Promise<ConversationFile[]> {
  const supabase = await createClient();
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
    messages: { sender_id: string; deleted_at: string | null } | { sender_id: string; deleted_at: string | null }[] | null;
  };
  const msg = (m: Row['messages']) => (Array.isArray(m) ? m[0] : m) ?? null;
  const rows = ((data ?? []) as Row[]).filter((r) => {
    const m = msg(r.messages);
    return m && !m.deleted_at;
  });
  if (rows.length === 0) return [];

  const paths = [...new Set(rows.map((r) => r.storage_path))];
  const { data: signed } = await supabase.storage.from('chat-media').createSignedUrls(paths, 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  const names = await resolveNames([...new Set(rows.map((r) => msg(r.messages)!.sender_id))]);

  return rows.map((r) => ({
    id: r.id,
    kind: (['image', 'video', 'audio', 'document'].includes(r.kind) ? r.kind : 'document') as AttachmentKind,
    url: urlByPath.get(r.storage_path) ?? null,
    mime: r.mime,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
    senderName: names.get(msg(r.messages)!.sender_id) ?? null,
  }));
}

/** The "About Topic" of a conversation for the right-rail. */
export interface ChatAbout {
  title: string | null;
  topic: string | null;
  description: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string | null;
}

export async function getConversationAbout(conversationId: string): Promise<ChatAbout> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('conversations')
    .select('title, topic, description, note, created_by, created_at')
    .eq('id', conversationId)
    .maybeSingle();
  const c = data as {
    title: string | null;
    topic: string | null;
    description: string | null;
    note: string | null;
    created_by: string | null;
    created_at: string | null;
  } | null;
  if (!c) return { title: null, topic: null, description: null, note: null, createdByName: null, createdAt: null };
  const names = c.created_by ? await resolveNames([c.created_by]) : new Map<string, string>();
  return {
    title: c.title,
    topic: c.topic,
    description: c.description,
    note: c.note,
    createdByName: c.created_by ? (names.get(c.created_by) ?? null) : null,
    createdAt: c.created_at,
  };
}

/** A pinned message, for the right-rail Pinned tab. */
export interface PinnedMessage {
  pinId: string;
  messageId: string;
  body: string | null;
  senderName: string | null;
  createdAt: string;
  pinnedByName: string | null;
}

/** Messages pinned in a conversation (newest pin first). Pins on deleted messages
 *  are dropped. RLS scopes to chat members. */
export async function listPinnedMessages(conversationId: string): Promise<PinnedMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_pins')
    .select('id, message_id, pinned_by, created_at, messages(body, sender_id, deleted_at)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  type Row = {
    id: string;
    message_id: string;
    pinned_by: string | null;
    created_at: string;
    messages: { body: string | null; sender_id: string; deleted_at: string | null }
      | { body: string | null; sender_id: string; deleted_at: string | null }[]
      | null;
  };
  const msg = (m: Row['messages']) => (Array.isArray(m) ? m[0] : m) ?? null;
  const rows = ((data ?? []) as Row[]).filter((r) => {
    const m = msg(r.messages);
    return m && !m.deleted_at;
  });
  if (rows.length === 0) return [];

  const names = await resolveNames([
    ...new Set(rows.flatMap((r) => [msg(r.messages)!.sender_id, r.pinned_by].filter(Boolean) as string[])),
  ]);
  return rows.map((r) => {
    const m = msg(r.messages)!;
    return {
      pinId: r.id,
      messageId: r.message_id,
      body: m.body,
      senderName: names.get(m.sender_id) ?? null,
      createdAt: r.created_at,
      pinnedByName: r.pinned_by ? (names.get(r.pinned_by) ?? null) : null,
    };
  });
}
