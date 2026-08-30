'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';

/** Update the signed-in user's profile — name, company, phone. Shown across
 *  tasks, chat, and team rosters (name preferred over email everywhere). */
export async function updateDisplayName(formData: FormData) {
  const name = String(formData.get('displayName') ?? '').trim();
  const company = String(formData.get('company') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: name || null, company: company || null, phone: phone || null })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  revalidatePath('/account');
}

/** Turn the Monday "your week" digest email on or off for the active org. Goes
 *  through a SECURITY DEFINER RPC so it only ever flips the caller's own flag. */
export async function setWeeklyDigest(formData: FormData) {
  const next = formData.get('next') === 'true';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) return;
  const { error } = await supabase.rpc('set_weekly_digest_opt_in', { p_org: ctx.active.orgId, p_opt: next });
  if (error) throw new Error(error.message);
  revalidatePath('/account');
}
