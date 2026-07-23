import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { LiveRefresh } from '@/components/live-refresh';
import { getProject } from '@/lib/data/projects';
import { getDashboardData } from '@/lib/data/dashboard';
import { getProjectProgress, getProgressHistory } from '@/lib/data/subtasks';
import { StatCards } from '@/components/dashboard/stat-cards';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';
import { ProgressTrend } from '@/components/dashboard/progress-trend';
import { Button } from '@/components/ui/button';

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

  const [{ counts, tasks }, projectPct, history] = await Promise.all([
    getDashboardData(project.org_id, projectId),
    getProjectProgress(projectId),
    getProgressHistory(projectId),
  ]);

  return (
    <div className="mx-auto flex max-w-[1152px] flex-col gap-8 px-10 py-8">
      <LiveRefresh
        subscriptions={[
          { table: 'tasks', filter: `project_id=eq.${projectId}` },
          { table: 'task_subtasks', filter: `org_id=eq.${project.org_id}` },
        ]}
      />
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.client_name && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{project.client_name}</p>
          )}
          {tasks.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 w-48 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-2 rounded-full bg-brand-600 transition-all" style={{ width: `${projectPct}%` }} />
              </div>
              <span
                className="text-xs font-medium tabular-nums text-zinc-500"
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

      <StatCards counts={counts} />

      <TimelineOverview tasks={tasks} />
    </div>
  );
}
