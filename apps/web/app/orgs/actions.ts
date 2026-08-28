'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { orgSetupSchema, type OrgSetupInput } from '@datumpro/shared/validation';
import { logAudit } from '@/lib/audit';

export type CreateOrgResult = { error: string };

/** Creates an organisation from the setup wizard.
 *
 *  Called from the client `NewCompanyForm` with a typed payload once the owner has
 *  (a) verified their login email via OTP and (b) accepted the Terms & Privacy
 *  checkbox. Both are re-checked here so the guarantees don't rely on the client:
 *  the email must be confirmed (email_confirmed_at set — which the OTP step does),
 *  and termsAccepted must be true (enforced by the schema's literal). The owner's
 *  full name seeds profiles.display_name so the app greets them by name, not email.
 *
 *  Returns `{ error }` on failure (shown inline by the form) or redirects to the
 *  done screen on success. */
export async function createOrg(input: OrgSetupInput): Promise<CreateOrgResult | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const parsed = orgSetupSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  // Verification gate: the email must be confirmed (the OTP step sets this). Never
  // trust the client to have run it — check the auth record itself.
  if (!user.email_confirmed_at) {
    return { error: 'Verify your email before creating a company.' };
  }

  const d = parsed.data;

  // Set the owner's display name first so their identity is on record even if the
  // org insert below fails and they retry. RLS lets a user update their own row.
  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ display_name: d.fullName })
    .eq('id', user.id);
  if (profileErr) {
    return { error: profileErr.message };
  }

  // Atomic create via SECURITY DEFINER RPC: inserts the org + owner membership and
  // returns the id as a scalar (a plain insert().select('id') fails RLS because the
  // owner membership is added inside the same call — see migration 20260101007500).
  const { data: orgId, error } = await supabase.rpc('create_organization', {
    p_name: d.name,
    p_legal_name: d.legalName ?? null,
    p_country: d.country ?? null,
    p_sector: d.sector ?? null,
    p_registration_number: d.registrationNumber ?? null,
    p_contact_email: d.contactEmail ?? null,
    p_contact_phone: d.contactPhone ?? null,
    p_terms_accepted: d.termsAccepted,
  });
  if (error || !orgId) {
    return { error: error?.message ?? 'Could not create your company. Please try again.' };
  }
  await logAudit({
    orgId,
    actorId: user.id,
    entityType: 'organization',
    entityId: orgId,
    action: 'organization.created',
    after: { name: d.name },
  });

  revalidatePath('/dashboard');
  redirect(`/orgs/new/done?org=${orgId}`);
}
