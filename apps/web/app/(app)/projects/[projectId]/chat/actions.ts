'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  listMessagesBefore,
  listMessagesSince,
  getMessage,
  searchMessages as searchMessagesData,
  type ChatMessage,
  type ChatSearchResult,
} from '@/lib/data/chat';
import { listMemberActivity, type ActivityItem } from '@/lib/data/chat-roster';

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

/** A roster member's recent activity — lazily loaded when the People rail detail
 *  view opens. RLS scopes the audit log to the caller's org. */
export async function getMemberActivity(
  projectId: string,
  userId: string,
): Promise<ActivityItem[]> {
  await requireUser();
  return listMemberActivity(projectId, userId);
}

/** Metadata for a file the client has already uploaded to the `chat-media`
 *  bucket. The bytes never pass through the server action — only the key. */
export interface AttachmentInput {
  kind: 'image' | 'video' | 'audio' | 'document';
  storagePath: string;
  mime?: string | null;
  filename?: string | null;
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
}

/** Insert a message (optionally a threaded reply, optionally with attachments the
 *  client already uploaded). Returns the new row for optimistic render. A message
 *  with attachments may have an empty body. */
export async function sendMessage(
  conversationId: string,
  body: string,
  parentMessageId?: string,
  attachments?: AttachmentInput[],
) {
  const trimmed = body.trim();
  const atts = attachments ?? [];
  if (!trimmed && atts.length === 0) return null;
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: trimmed || null,
      parent_message_id: parentMessageId ?? null,
    })
    .select('id, seq, created_at')
    .single();
  if (error) throw new Error(error.message);
  const message = data as { id: string; seq: number; created_at: string };

  if (atts.length > 0) {
    const { error: attErr } = await supabase.from('message_attachments').insert(
      atts.map((a) => ({
        message_id: message.id,
        kind: a.kind,
        storage_path: a.storagePath,
        mime: a.mime ?? null,
        filename: a.filename ?? null,
        size_bytes: a.sizeBytes ?? null,
        duration_seconds: a.durationSeconds ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
      })),
    );
    if (attErr) throw new Error(attErr.message);
  }
  return message;
}

/** A page of older messages (seq < beforeSeq) for infinite-scroll-up. */
export async function loadEarlier(
  conversationId: string,
  beforeSeq: number,
): Promise<ChatMessage[]> {
  const { user } = await requireUser();
  return listMessagesBefore(conversationId, user.id, beforeSeq);
}

/** Only messages newer than sinceSeq — the new-message / reconnect delta. */
export async function loadSince(conversationId: string, sinceSeq: number): Promise<ChatMessage[]> {
  const { user } = await requireUser();
  return listMessagesSince(conversationId, user.id, sinceSeq);
}

/** One freshly-hydrated message — for an edit/delete/reaction to a visible row. */
export async function loadOne(conversationId: string, messageId: string): Promise<ChatMessage | null> {
  const { user } = await requireUser();
  return getMessage(conversationId, user.id, messageId);
}

/** Full-text search within a conversation (RLS-scoped). */
export async function searchMessages(
  conversationId: string,
  query: string,
): Promise<ChatSearchResult[]> {
  await requireUser();
  return searchMessagesData(conversationId, query);
}

export async function editMessage(messageId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return;
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('messages')
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw new Error(error.message);
}

/** Soft-delete (audit trail preserved). RLS: sender, or a project PM / staff. */
export async function deleteMessage(messageId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw new Error(error.message);
}

/** Toggle one emoji reaction for the current user. */
export async function toggleReaction(messageId: string, emoji: string) {
  const { supabase, user } = await requireUser();
  const { data: existing } = await supabase
    .from('message_reactions')
    .select('id')
    .eq('message_id', messageId)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle();
  if (existing) {
    await supabase.from('message_reactions').delete().eq('id', (existing as { id: string }).id);
  } else {
    const { error } = await supabase
      .from('message_reactions')
      .insert({ message_id: messageId, user_id: user.id, emoji });
    if (error) throw new Error(error.message);
  }
}

/** Mark everything up to `uptoSeq` read (receipts + read cursor). */
export async function markRead(conversationId: string, uptoSeq: number) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
    p_upto_seq: uptoSeq,
  });
  if (error) throw new Error(error.message);
}
