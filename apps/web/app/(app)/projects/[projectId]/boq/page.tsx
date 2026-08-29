import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myOrgRole } from '@/lib/data/tasks';
import { myProjectRole } from '@/lib/data/members';
import {
  getProjectBoq,
  getBoqDetail,
  listUnlinkedBoqs,
  listCloneableBoqs,
  listBoqGeneratedTasks,
  type BoqGeneratedTask,
} from '@/lib/data/boq';
import { listOrgMembers } from '@/lib/data/org-members';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BoqTabControls } from './boq-tab-controls';
import { BoqBoard, type SectionTask, type ContractorOption } from './boq-board';
import { SchedulePanel } from './schedule-panel';

export default async function ProjectBoqPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ genError?: string; notice?: string }>;
}) {
  const { projectId } = await params;
  const { genError, notice } = await searchParams;

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
  const [unlinked, cloneable] = boq
    ? [[], []]
    : await Promise.all([listUnlinkedBoqs(project.org_id), listCloneableBoqs(project.org_id, projectId)]);

  // Board data: the full priced bill + the generated section-tasks (for the
  // per-section assign picker) + active contractor options.
  const detail = boq ? await getBoqDetail(project.org_id, boq.id) : null;
  let generatedTasks: BoqGeneratedTask[] = [];
  let contractors: ContractorOption[] = [];
  let memberNames: Record<string, string> = {};
  if (boq?.tasksGenerated) {
    const [tasks, members] = await Promise.all([
      listBoqGeneratedTasks(project.org_id, projectId, boq.id),
      listOrgMembers(project.org_id),
    ]);
    generatedTasks = tasks;
    contractors = members
      .filter((m) => m.status === 'active' && m.memberType === 'contractor')
      .map((m) => ({ userId: m.userId, name: m.name }));
    memberNames = Object.fromEntries(members.map((m) => [m.userId, m.name]));
  }
  const tasksBySection: Record<string, SectionTask> = {};
  for (const t of generatedTasks) {
    if (t.boqSectionId) {
      tasksBySection[t.boqSectionId] = {
        taskId: t.id,
        assigneeId: t.assigneeId,
        acceptanceStatus: t.acceptanceStatus,
      };
    }
  }

  return (
    <PageContainer width="6xl">
      <PageHeader
        title="Bill of Quantities"
        subtitle={
          boq
            ? `${boq.sectionCount} sections · ${boq.itemCount} items · ${boq.currency} ${(boq.totalCents / 100).toLocaleString()}`
            : 'Assign the bill to contractors — priced by line, section by section.'
        }
      />

      {genError && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {genError}
        </p>
      )}
      {notice && (
        <p className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400">
          {notice}
        </p>
      )}

      {boq === null ? (
        <Card className="mt-6">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No bill for this project yet. Draft a new one, or clone another project&apos;s bill as a starting
            point — its line items become this project&apos;s tasks.
          </p>
          <BoqTabControls projectId={projectId} boq={null} unlinked={unlinked} cloneable={cloneable} />
        </Card>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={`/boq/${boq.id}`}
              className="text-lg font-medium text-brand-600 hover:underline dark:text-brand-500"
            >
              {boq.name} →
            </Link>
            <Badge tone={boq.status === 'approved' ? 'green' : 'faint'}>{boq.status}</Badge>
            {boq.tenderStatus && <Badge tone="blue">tender: {boq.tenderStatus}</Badge>}
          </div>

          {boq.changedSinceGeneration && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
              The bill changed after tasks were generated. Scope changes flow through task variations —
              the generated tasks are not re-synced automatically.
            </p>
          )}

          {boq.tasksGenerated ? (
            <>
              <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
                Tasks were generated from this bill —{' '}
                <Link
                  href={`/projects/${projectId}/tasks`}
                  className="font-medium text-brand-600 hover:underline dark:text-brand-500"
                >
                  view tasks →
                </Link>
              </p>
              <SchedulePanel projectId={projectId} boqId={boq.id} defaultStartDate={project.start_date} />
            </>
          ) : (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
              No tasks generated yet. Generating creates one task per section with budget-priced subtasks
              per line — then you assign each section to a contractor below.
            </p>
          )}

          {detail && (
            <BoqBoard
              projectId={projectId}
              currency={boq.currency}
              sections={detail.sections}
              items={detail.items}
              tasksBySection={tasksBySection}
              contractors={contractors}
              memberNames={memberNames}
            />
          )}

          <BoqTabControls projectId={projectId} boq={boq} unlinked={[]} cloneable={[]} />
        </>
      )}
    </PageContainer>
  );
}
