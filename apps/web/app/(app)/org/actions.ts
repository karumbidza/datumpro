'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** Rename the organisation. RLS restricts organizations UPDATE to owner/admin,
 *  so a non-admin's write is rejected at the database regardless of the UI. */
export async function renameOrganization(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!orgId) throw new Error('Missing organisation');
  if (!name) throw new Error('Organisation name is required');
  if (name.length > 120) throw new Error('That name is too long');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.from('organizations').update({ name }).eq('id', orgId);
  if (error) throw new Error(error.message);

  // The name shows in the sidebar switcher too — refresh the whole shell.
  revalidatePath('/', 'layout');
}
