'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { createProjectSchema, createClientSchema } from '@datumpro/shared/validation';
import type { FormState } from '@/components/ui/form-error';

/** Creates a project under the user's ACTIVE company. RLS requires owner/admin/PM
 *  of that company. `code` and `end_date` are assigned by DB triggers (collision-
 *  safe code; end derived via add_working_days). Duration is entered in weeks|days
 *  and stored as working days, converted server-side from the calendar pattern so
 *  the client can't spoof it. Contract value arrives as currency units, stored as
 *  integer cents. */
export async function createProject(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  const orgId = ctx.active.orgId;

  const dollars = Number(formData.get('contractValue') ?? 0);
  const durationValue = Number(formData.get('durationValue') ?? 0);
  const parsed = createProjectSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    type: 'construction',
    constructionType: String(formData.get('constructionType') ?? ''),
    clientId: String(formData.get('clientId') ?? ''),
    managerId: String(formData.get('managerId') ?? ''),
    startDate: String(formData.get('startDate') ?? ''),
    durationValue: Number.isFinite(durationValue) ? durationValue : 0,
    durationUnit: String(formData.get('durationUnit') ?? 'weeks'),
    calendarId: String(formData.get('calendarId') ?? ''),
    currency: String(formData.get('currency') ?? ''),
    contractValueCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
    templateId: (formData.get('templateId') as string) || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const d = parsed.data;

  // Resolve working-days-per-week from the chosen calendar (also validates it
  // belongs to this org via RLS). Weeks → working days happens here, server-side.
  const { data: cal } = await supabase
    .from('work_calendars')
    .select('works_mon, works_tue, works_wed, works_thu, works_fri, works_sat, works_sun')
    .eq('id', d.calendarId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!cal) return { error: 'Work calendar not found.' };
  const c = cal as Record<string, boolean>;
  const wdpw =
    ['works_mon', 'works_tue', 'works_wed', 'works_thu', 'works_fri', 'works_sat', 'works_sun'].filter(
      (k) => c[k],
    ).length || 5;
  const durationWorkingDays = d.durationUnit === 'weeks' ? d.durationValue * wdpw : d.durationValue;

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      org_id: orgId,
      name: d.name,
      type: d.type,
      construction_type: d.constructionType,
      client_id: d.clientId,
      currency: d.currency,
      calendar_id: d.calendarId,
      start_date: d.startDate,
      duration_working_days: durationWorkingDays,
      contract_value_cents: d.contractValueCents,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };
  const projectId = (project as { id: string }).id;

  // The selected manager becomes a PM member. The creator is already added as PM
  // by the on_project_created trigger; a conflict here (manager == creator) is
  // expected and ignored.
  await supabase
    .from('project_members')
    .insert({ org_id: orgId, project_id: projectId, user_id: d.managerId, role: 'pm' })
    .then(
      () => {},
      () => {},
    );

  revalidatePath('/projects');
  redirect(`/projects/${projectId}`);
}

/** Creates a client inline from the project form's "New client" sub-form. Returns
 *  the new record so the caller can select it without losing form state. */
export async function createClientAction(input: {
  name: string;
  email?: string;
  phone?: string;
}): Promise<{ client?: { id: string; name: string }; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };
  const ctx = await getActiveContext();
  if (!ctx?.active) return { error: 'No active organisation.' };

  const parsed = createClientSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(', ') };

  const { data, error } = await supabase
    .from('clients')
    .insert({
      org_id: ctx.active.orgId,
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      created_by: user.id,
    })
    .select('id, name')
    .single();
  if (error) {
    if (error.code === '23505') return { error: 'A client with that name already exists.' };
    return { error: error.message };
  }
  return { client: data as { id: string; name: string } };
}
