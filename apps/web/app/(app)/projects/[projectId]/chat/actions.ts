'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** Insert a chat message. RLS enforces the sender is a member of the
 *  conversation; the DB trigger denormalizes scope and broadcasts to the private
 *  channel. Returns the new row so the sender can render it optimistically. */
export async function sendMessage(conversationId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body: trimmed })
    .select('id, seq, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; seq: number; created_at: string };
}

/** Mark everything up to `uptoSeq` read (writes per-recipient receipts + the
 *  read cursor via the SECURITY INVOKER RPC). */
export async function markRead(conversationId: string, uptoSeq: number) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
    p_upto_seq: uptoSeq,
  });
  if (error) throw new Error(error.message);
}
