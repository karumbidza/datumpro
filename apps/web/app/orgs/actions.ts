'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createOrgSchema } from '@datumpro/shared/validation';

/** Creates an organisation. A DB trigger makes the creator its `owner`, so no
 *  separate membership insert is needed here. */
export async function createOrg(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const parsed = createOrgSchema.safeParse({ name: String(formData.get('name') ?? '') });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '));
  }

  const { error } = await supabase.from('organizations').insert({ name: parsed.data.name });
  if (error) throw new Error(error.message);

  revalidatePath('/dashboard');
  redirect('/dashboard');
}
