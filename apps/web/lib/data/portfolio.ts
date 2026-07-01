import { createClient } from '@/lib/supabase/server';
import type { ProjectStatus, ProjectType, TaskPriority, TaskStatus } from '@datumpro/shared/domain';

export interface PortfolioKpis {
  total: number;
  active: number;
  onHold: number;
  completed: number;
  planning: number;
  overallProgressPct: number;
}

export interface RecentProject {
  id: string;
  name: string;
  clientName: string | null;
  status: ProjectStatus;
  type: ProjectType;
  progressPct: number;
}

export interface UpcomingTask {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  priority: TaskPriority;
  dueDate: string;
  assigneeName: string | null;
}

export interface PortfolioData {
  kpis: PortfolioKpis;
  statusDistribution: { status: ProjectStatus; count: number }[];
  recentProjects: RecentProject[];
  upcomingTasks: UpcomingTask[];
  progressSeries: { date: string; pct: number }[];
}

const ALL_STATUSES: ProjectStatus[] = ['planning', 'active', 'on_hold', 'completed', 'archived'];

/** Portfolio-level aggregates for the company home. RLS scopes everything to what
 *  the viewer may see; no task cost is read, so it's confidentiality-safe. */
export async function getPortfolioData(orgId: string): Promise<PortfolioData> {
  const supabase = await createClient();

  const [projectsRes, reportsRes, tasksRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, client_name, status, type, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('site_reports')
      .select('project_id, report_date, progress_pct')
      .eq('org_id', orgId)
      .order('report_date', { ascending: true }),
    supabase
      .from('tasks')
      .select('id, title, project_id, priority, due_date, assignee_id, status')
      .eq('org_id', orgId)
      .not('due_date', 'is', null)
      .neq('status', 'done')
      .order('due_date', { ascending: true })
      .limit(8),
  ]);

  const projects = (projectsRes.data ?? []) as {
    id: string;
    name: string;
    client_name: string | null;
    status: ProjectStatus;
    type: ProjectType;
    created_at: string;
  }[];
  const reports = (reportsRes.data ?? []) as {
    project_id: string;
    report_date: string;
    progress_pct: number;
  }[];
  const tasks = (tasksRes.data ?? []) as {
    id: string;
    title: string;
    project_id: string;
    priority: TaskPriority;
    due_date: string;
    assignee_id: string | null;
    status: TaskStatus;
  }[];

  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  // Latest reported progress per project (reports are asc, so last wins).
  const latestProgress = new Map<string, number>();
  for (const r of reports) latestProgress.set(r.project_id, r.progress_pct);

  const nonArchived = projects.filter((p) => p.status !== 'archived');
  const overallProgressPct =
    nonArchived.length > 0
      ? Math.round(
          nonArchived.reduce((sum, p) => sum + (latestProgress.get(p.id) ?? 0), 0) / nonArchived.length,
        )
      : 0;

  const countBy = (s: ProjectStatus) => projects.filter((p) => p.status === s).length;
  const kpis: PortfolioKpis = {
    total: projects.filter((p) => p.status !== 'archived').length,
    active: countBy('active'),
    onHold: countBy('on_hold'),
    completed: countBy('completed'),
    planning: countBy('planning'),
    overallProgressPct,
  };

  const statusDistribution = ALL_STATUSES.map((status) => ({ status, count: countBy(status) })).filter(
    (s) => s.count > 0,
  );

  const recentProjects: RecentProject[] = projects.slice(0, 6).map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.client_name,
    status: p.status,
    type: p.type,
    progressPct: latestProgress.get(p.id) ?? 0,
  }));

  // Assignee names for the upcoming-tasks table.
  const assigneeIds = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', assigneeIds);
    names = new Map(
      ((profiles ?? []) as { id: string; display_name: string | null; email: string | null }[]).map(
        (p) => [p.id, p.display_name || p.email || 'Member'],
      ),
    );
  }
  const upcomingTasks: UpcomingTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectId: t.project_id,
    projectName: projectName.get(t.project_id) ?? 'Project',
    priority: t.priority,
    dueDate: t.due_date,
    assigneeName: t.assignee_id ? names.get(t.assignee_id) ?? null : null,
  }));

  // Company progress-over-time: average of all reports on each date, last 12 points.
  const byDate = new Map<string, { sum: number; n: number }>();
  for (const r of reports) {
    const cur = byDate.get(r.report_date) ?? { sum: 0, n: 0 };
    cur.sum += r.progress_pct;
    cur.n += 1;
    byDate.set(r.report_date, cur);
  }
  const progressSeries = [...byDate.entries()]
    .map(([date, { sum, n }]) => ({ date, pct: Math.round(sum / n) }))
    .slice(-12);

  return { kpis, statusDistribution, recentProjects, upcomingTasks, progressSeries };
}
