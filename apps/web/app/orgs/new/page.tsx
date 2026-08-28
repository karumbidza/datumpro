import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/data/org';
import { Card } from '@/components/ui/card';
import { isBusinessEmail } from '@datumpro/shared/validation';
import { NewCompanyForm } from './new-company-form';

export default async function NewOrgPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  // One organisation per owner: an account that already owns one can't create
  // another (the DB cap enforces this too — this is the friendly redirect so an
  // existing owner never lands on a form that would only error). Being a member
  // of other orgs doesn't count; only an active owner membership blocks.
  const supabase = await createClient();
  const { count: ownedCount } = await supabase
    .from('org_members')
    .select('org_id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .eq('status', 'active');
  if ((ownedCount ?? 0) > 0) redirect('/dashboard');

  // Non-blocking nudge only — the org is created regardless (see spec §0/§7).
  const personalEmail = !!user.email && !isBusinessEmail(user.email);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <Card>
        <NewCompanyForm
          loginEmail={user.email ?? ''}
          emailConfirmed={!!user.email_confirmed_at}
          personalEmail={personalEmail}
        />
      </Card>
    </main>
  );
}
