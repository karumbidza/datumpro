'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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
