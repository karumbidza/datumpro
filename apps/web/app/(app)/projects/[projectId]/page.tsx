import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { getDashboardData } from '@/lib/data/dashboard';
import { getProjectProgress, getProgressHistory } from '@/lib/data/subtasks';
import { getProjectSetup } from '@/lib/data/project-setup';
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [{ counts, tasks }, projectPct, history, setup] = await Promise.all([
    getDashboardData(project.org_id, projectId),
    getProjectProgress(projectId),
    getProgressHistory(projectId),
    getProjectSetup(projectId),
  ]);

  return (
    <div className="mx-auto flex max-w-[1152px] flex-col gap-8 px-10 py-8">
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

      {setup.pct < 100 && (
        <Link
          href={`/projects/${projectId}/setup`}
          className="flex items-center justify-between gap-3 rounded-lg border border-brand-500/30 bg-brand-50 px-4 py-3 hover:border-brand-500/60 dark:bg-brand-500/10"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-brand-600">Project setup — {setup.pct}% complete</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {setup.total - setup.done} item{setup.total - setup.done === 1 ? '' : 's'} outstanding · finish setting up this project
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-brand-600">Open →</span>
        </Link>
      )}

      <StatCards counts={counts} />

      <TimelineOverview tasks={tasks} />
    </div>
  );
}
