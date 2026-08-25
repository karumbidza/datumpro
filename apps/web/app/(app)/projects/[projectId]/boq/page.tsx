import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myOrgRole } from '@/lib/data/tasks';
import { myProjectRole } from '@/lib/data/members';
import { getProjectBoq, listUnlinkedBoqs } from '@/lib/data/boq';
import { PageContainer } from '@/components/shell/page-container';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BoqTabControls } from './boq-tab-controls';

export default async function ProjectBoqPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ genError?: string }>;
}) {
  const { projectId } = await params;
  const { genError } = await searchParams;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  // Management surface, same audience as Finance: org owner/admin, or this
  // project's PM. Contractors/contributors never see the bill or budget rates.
  const [orgRole, projectRole] = await Promise.all([myOrgRole(project.org_id), myProjectRole(projectId)]);
  const manages = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
  if (!manages) notFound();

  const boq = await getProjectBoq(project.org_id, projectId);
  const unlinked = boq ? [] : await listUnlinkedBoqs(project.org_id);

  return (
    <PageContainer width="xl">
      <h1 className="text-2xl font-semibold tracking-tight">Bill of Quantities</h1>

      {genError && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {genError}
        </p>
      )}

      {boq === null ? (
        <Card className="mt-6">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No bill is attached to this project. Attach an existing bill from the library, or draft a new
            one — its line items become the project&apos;s tasks.
          </p>
          <BoqTabControls projectId={projectId} boq={null} unlinked={unlinked} />
        </Card>
      ) : (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link
                href={`/boq/${boq.id}`}
                className="text-lg font-medium text-brand-600 hover:underline dark:text-brand-500"
              >
                {boq.name} →
              </Link>
              <Badge tone={boq.status === 'approved' ? 'green' : 'faint'}>{boq.status}</Badge>
              {boq.tenderStatus && <Badge tone="blue">tender: {boq.tenderStatus}</Badge>}
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {boq.sectionCount} sections · {boq.itemCount} items · {boq.currency}{' '}
              {(boq.totalCents / 100).toLocaleString()}
            </p>
          </div>

          {boq.changedSinceGeneration && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
              The bill changed after tasks were generated. Scope changes flow through task variations —
              the generated tasks are not re-synced automatically.
            </p>
          )}

          {boq.tasksGenerated ? (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
              Tasks were generated from this bill —{' '}
              <Link
                href={`/projects/${projectId}/tasks`}
                className="font-medium text-brand-600 hover:underline dark:text-brand-500"
              >
                view tasks →
              </Link>
            </p>
          ) : (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
              No tasks generated yet. Generating creates one task per section with budget-priced
              subtasks per line — unassigned, ready to hand to contractors.
            </p>
          )}

          <BoqTabControls projectId={projectId} boq={boq} unlinked={[]} />
        </Card>
      )}
    </PageContainer>
  );
}
