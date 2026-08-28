import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { Card } from '@/components/ui/card';
import { isBusinessEmail } from '@datumpro/shared/validation';
import { NewCompanyForm } from './new-company-form';

export default async function NewOrgPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

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
