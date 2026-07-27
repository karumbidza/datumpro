'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createOrgSchema } from '@datumpro/shared/validation';

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
  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      name,
      legal_name: legalName ?? null,
      country: country ?? null,
      sector: sector ?? null,
      registration_number: registrationNumber ?? null,
      onboarding_completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) redirect(`/orgs/new?error=${encodeURIComponent(error.message)}`);

  revalidatePath('/dashboard');
  redirect(`/orgs/new/done?org=${(org as { id: string }).id}`);
}
