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
