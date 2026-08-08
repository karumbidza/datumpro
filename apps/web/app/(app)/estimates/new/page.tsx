import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { PageContainer } from '@/components/shell/page-container';
import { Card } from '@/components/ui/card';
import { NewBoqForm } from './new-boq-form';

export default async function NewBoqPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  // Building a bill is a staff action; RLS enforces it too, but keep non-writers off the form.
  if (!['owner', 'admin', 'pm'].includes(ctx.active.role)) redirect('/estimates');

  return (
    <PageContainer width="xl">
      <Link href="/estimates" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
        ← Estimates
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Start a new BOQ</h1>
      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
        A few details, then you land on a blank bill to build. In organisation:{' '}
        <span className="font-medium text-brand-600 dark:text-brand-500">{ctx.active.name}</span>
      </p>

      <Card className="mt-6">
        <NewBoqForm />
      </Card>
    </PageContainer>
  );
}
