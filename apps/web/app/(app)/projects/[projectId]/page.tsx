import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject, listMilestones, listRecentReports } from '@/lib/data/projects';
import { getDashboardData } from '@/lib/data/dashboard';
import { getProjectSchedule } from '@/lib/data/scheduling';
import { myOrgRole } from '@/lib/data/tasks';
import { myProjectRole } from '@/lib/data/members';
import { listVariations } from '@/lib/data/variations';
import { MilestonesPanel } from '@/components/project/milestones-panel';
import { VariationsPanel } from '@/components/project/variations-panel';
import { StatCards } from '@/components/dashboard/stat-cards';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';
import { ScheduleSummary } from '@/components/project/schedule-summary';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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

  const [{ counts, tasks }, milestones, reports, schedule, orgRole, projectRole, variations] =
    await Promise.all([
      getDashboardData(project.org_id, projectId),
      listMilestones(projectId),
      listRecentReports(projectId),
      getProjectSchedule(projectId),
      myOrgRole(project.org_id),
      myProjectRole(projectId),
      listVariations(projectId),
    ]);

  const canManageMilestones = orgRole === 'owner' || orgRole === 'admin' || orgRole === 'pm';
  // Deciding a variation mirrors can_manage_project: org admin or the project PM.
  const canDecideVariations = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
  const latestProgress = reports[0]?.progress_pct ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8 xl:px-10">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.client_name && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{project.client_name}</p>
          )}
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

      {schedule && <ScheduleSummary data={schedule} />}

      <TimelineOverview tasks={tasks} />

      <Card>
        <CardTitle>Latest reported progress</CardTitle>
        <div className="mt-3 flex items-center gap-3">
          <Progress value={latestProgress} />
          <span className="text-sm font-medium tabular-nums">{latestProgress}%</span>
        </div>
      </Card>

      <VariationsPanel projectId={projectId} data={variations} canDecide={canDecideVariations} />

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MilestonesPanel projectId={projectId} milestones={milestones} canManage={canManageMilestones} />

        <div>
          <h2 className="mb-3 text-sm font-semibold">Recent site reports</h2>
          {reports.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No reports yet.</p>
          ) : (
            <ul className="space-y-2">
              {reports.map((r) => (
                <li key={r.id}>
                  <Card>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{r.report_date}</span>
                      <Badge tone={r.status === 'submitted' ? 'blue' : 'neutral'}>{r.status}</Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={r.progress_pct} />
                      <span className="text-xs tabular-nums text-zinc-500">{r.progress_pct}%</span>
                    </div>
                    {r.narrative && (
                      <p className="mt-2 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {r.narrative}
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
