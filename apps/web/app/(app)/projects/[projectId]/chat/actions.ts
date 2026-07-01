'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listMessages, type ChatMessage } from '@/lib/data/chat';

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

/** Reload the recent window (server truth) — called by the client on any channel
 *  event. Reuses the RLS-scoped data layer, incl. names + reactions. */
export async function loadMessages(conversationId: string): Promise<ChatMessage[]> {
  const { user } = await requireUser();
  return listMessages(conversationId, user.id);
}

/** Insert a message (optionally a threaded reply). Returns the new row for
 *  optimistic render. */
export async function sendMessage(conversationId: string, body: string, parentMessageId?: string) {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: trimmed,
      parent_message_id: parentMessageId ?? null,
    })
    .select('id, seq, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; seq: number; created_at: string };
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
