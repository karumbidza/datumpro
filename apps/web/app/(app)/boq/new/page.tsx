import { redirect } from 'next/navigation';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { NewBoqForm } from './new-boq-form';

export default async function NewBoqPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  // Building a bill is a staff action; RLS enforces it too, but keep non-writers off the form.
  if (!['owner', 'admin', 'pm'].includes(ctx.active.role)) redirect('/boq');

  return (
    <PageContainer width="xl">
      <PageHeader
        backHref="/boq"
        backLabel="BOQ"
        title="Start a new BOQ"
        subtitle={
          <>
            A few details, then you land on a blank bill to build. In organisation:{' '}
            <span className="font-medium text-brand-600 dark:text-brand-500">{ctx.active.name}</span>
          </>
        }
      />

      <Card className="mt-6">
        <NewBoqForm />
      </Card>
    </PageContainer>
  );
}
