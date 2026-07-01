import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { sendEmail } from './resend';

/** Look up a user's email (via their profile, RLS-scoped to org co-members) and
 *  send them a transactional message. Best-effort — never throws, so it can't
 *  break the action that triggered it. */
export async function emailUser(
  userId: string | null | undefined,
  msg: { subject: string; html: string },
): Promise<void> {
  try {
    if (!userId) return;
    const supabase = await createClient();
    const { data } = await supabase.from('profiles').select('email').eq('id', userId).single();
    const to = (data as { email: string | null } | null)?.email;
    if (!to) return;
    await sendEmail({ to, subject: msg.subject, html: msg.html });
  } catch (e) {
    console.error('[email] emailUser failed', e);
  }
}
