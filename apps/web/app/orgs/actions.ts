'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createOrgSchema } from '@datumpro/shared/validation';
import { logAudit } from '@/lib/audit';

/** Creates an organisation from the setup-wizard profile form. A DB trigger makes
 *  the creator its `owner`, so no separate membership insert is needed here.
 *  Note: the work-email check is a NON-blocking nudge rendered on the /orgs/new
 *  screen (see NewOrgPage); org creation itself never blocks on it. */
export async function createOrg(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const parsed = createOrgSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    legalName: String(formData.get('legalName') ?? ''),
    country: String(formData.get('country') ?? ''),
    sector: String(formData.get('sector') ?? ''),
    registrationNumber: String(formData.get('registrationNumber') ?? ''),
  });
  if (!parsed.success) {
    redirect(`/orgs/new?error=${encodeURIComponent(parsed.error.issues.map((i) => i.message).join(', '))}`);
  }

  const { name, legalName, country, sector, registrationNumber } = parsed.data;
  // Atomic create via SECURITY DEFINER RPC: inserts the org + owner membership and
  // returns the id as a scalar. A plain `insert().select('id')` fails here because
  // RETURNING applies the SELECT policy (is_org_member) to the brand-new row, but
  // the owner membership is only added by the AFTER trigger — see migration
  // 20260101007500.
  const { data: orgId, error } = await supabase.rpc('create_organization', {
    p_name: name,
    p_legal_name: legalName ?? null,
    p_country: country ?? null,
    p_sector: sector ?? null,
    p_registration_number: registrationNumber ?? null,
  });
  if (error || !orgId) {
    redirect(`/orgs/new?error=${encodeURIComponent(error?.message ?? 'Could not create your company. Please try again.')}`);
  }
  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'organization.created', after: { name } });

  revalidatePath('/dashboard');
  redirect(`/orgs/new/done?org=${orgId}`);
}
