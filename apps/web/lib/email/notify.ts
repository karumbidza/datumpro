import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from './resend';

/** Look up a user's email and send them a transactional message. The email
 *  column is no longer readable by the authenticated role (audit UB-AUD-1709 #1),
 *  so this system path resolves it via the service role. Best-effort — never
 *  throws, so it can't break the action that triggered it. */
export async function emailUser(
  userId: string | null | undefined,
  msg: { subject: string; html: string },
): Promise<void> {
  try {
    if (!userId) return;
    const supabase = createAdminClient();
    const { data } = await supabase.from('profiles').select('email').eq('id', userId).single();
    const to = (data as { email: string | null } | null)?.email;
    if (!to) return;
    await sendEmail({ to, subject: msg.subject, html: msg.html });
  } catch (e) {
    console.error('[email] emailUser failed', e);
  }
}
