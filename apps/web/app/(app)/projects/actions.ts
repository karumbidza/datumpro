'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { createProjectSchema } from '@datumpro/shared/validation';

/** Creates a project under the user's ACTIVE company (the org switcher's choice).
 *  RLS requires the caller to be owner/admin of that company; the creator is
 *  auto-added as the project's PM by a DB trigger. Contract value arrives as USD
 *  dollars and is stored as integer cents. */
export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  const membership = { org_id: ctx.active.orgId };

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
