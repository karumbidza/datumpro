import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { getBoqDetail, getProjectBoq } from '@/lib/data/boq';
import { PageContainer } from '@/components/shell/page-container';
import { BoqBuilder } from './boq-builder';

export default async function BoqPage({ params }: { params: Promise<{ boqId: string }> }) {
  const { boqId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');

  const boq = await getBoqDetail(ctx.active.orgId, boqId);
  if (!boq) notFound();

  // An awarded bill is locked: the tender is settled, so its priced lines are the
  // contract baseline and must not drift. Managers still view it (read-only) and
  // reach the tender audit; changes now happen through delivery variations.
  const canEdit = ['owner', 'admin', 'pm'].includes(ctx.active.role) && boq.tenderStatus !== 'awarded';
  // Linked bill: fetch whether its tasks were already generated (drives the
  // "generate tasks" banner shown once the bill is approved).
  const projectBoq = boq.projectId ? await getProjectBoq(ctx.active.orgId, boq.projectId) : null;

  return (
    <PageContainer width="full">
      <Link href="/boq" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
        ← BOQ
      </Link>
      <BoqBuilder boq={boq} canEdit={canEdit} projectTasksGenerated={projectBoq?.tasksGenerated ?? false} />
    </PageContainer>
  );
}
