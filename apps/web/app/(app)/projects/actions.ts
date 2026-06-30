'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createProjectSchema } from '@datumpro/shared/validation';

/** Creates a project under the user's active org. RLS requires the user to be
 *  owner/admin/pm of that org. Contract value arrives as USD dollars and is
 *  stored as integer cents. */
export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (!membership) redirect('/orgs/new');

  const dollars = Number(formData.get('contractValue') ?? 0);
  const parsed = createProjectSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    clientName: (formData.get('clientName') as string) || undefined,
    type: 'construction',
    contractValueCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '));
  }

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      org_id: (membership as { org_id: string }).org_id,
      name: parsed.data.name,
      client_name: parsed.data.clientName ?? null,
      type: parsed.data.type,
      contract_value_cents: parsed.data.contractValueCents,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  revalidatePath('/projects');
  redirect(`/projects/${(project as { id: string }).id}`);
}
