import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { LiveRefresh } from '@/components/live-refresh';
import { getProject } from '@/lib/data/projects';
import { getDashboardData } from '@/lib/data/dashboard';
import { getProjectProgress, getProgressHistory } from '@/lib/data/subtasks';
import { listProjectActivityFull } from '@/lib/data/tasks';
import { listProjectMembers } from '@/lib/data/members';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';
import { ProgressTrend } from '@/components/dashboard/progress-trend';
import { ActivityPanel } from '@/components/project/activity-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PRIORITY_TONE } from '@/components/ui/tones';
import { TASK_PRIORITY_LABELS } from '@datumpro/shared/domain';

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [{ tasks }, projectPct, history, activity, members] = await Promise.all([
    getDashboardData(project.org_id, projectId),
    getProjectProgress(projectId),
    getProgressHistory(projectId),
    listProjectActivityFull(projectId),
    listProjectMembers(projectId),
  ]);

  return (
    <PageContainer width="6xl" className="flex flex-col gap-8">
      <LiveRefresh
        subscriptions={[
          { table: 'tasks', filter: `project_id=eq.${projectId}` },
          { table: 'task_subtasks', filter: `org_id=eq.${project.org_id}` },
          { table: 'task_activity', filter: `org_id=eq.${project.org_id}` },
        ]}
      />
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <span className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            {project.priority !== 'medium' && (
              <Badge tone={PRIORITY_TONE[project.priority]}>{TASK_PRIORITY_LABELS[project.priority]}</Badge>
            )}
          </span>
          {project.client_name && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{project.client_name}</p>
          )}
          {project.description && (
            <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{project.description}</p>
          )}
          {tasks.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 w-48 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-2 rounded-full bg-brand-600 transition-all" style={{ width: `${projectPct}%` }} />
              </div>
              <span
                className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400"
                title="Effort-weighted by each task's awarded contract value"
              >
                {projectPct}% complete
              </span>
            </div>
          )}
          <ProgressTrend points={history} className="mt-3 max-w-[240px]" />
        </div>
        <div className="flex gap-2">
          <Link href={`/projects/${projectId}/reports/new`}>
            <Button variant="secondary">New site report</Button>
          </Link>
          <Link href={`/projects/${projectId}/tasks/new`}>
            <Button>New task</Button>
          </Link>
        </div>
      </header>

      <TimelineOverview tasks={tasks} />

      <ActivityPanel
        items={activity}
        members={members.map((m) => ({ userId: m.userId, name: m.name }))}
        projectId={projectId}
        taskCount={tasks.length}
      />
    </PageContainer>
  );
}
