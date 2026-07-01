import { createClient } from '@/lib/supabase/server';
import type { TaskStatus, TaskSlaStatus } from '@datumpro/shared/domain';

/** A task flattened with the names the dashboard/timeline need to render. */
export interface DashboardTask {
  id: string;
  title: string;
  status: TaskStatus;
  sla_status: TaskSlaStatus;
  project_id: string;
  projectName: string;
  assigneeName: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  due_date: string | null;
}

export interface DashboardCounts {
  pendingSignoff: number;
  blockers: number;
  breaches: number;
  openRequests: number;
}

export interface DashboardData {
  counts: DashboardCounts;
  tasks: DashboardTask[];
}

const TERMINAL_STATUSES: TaskStatus[] = ['done'];

function isOverdue(task: { due_date: string | null; status: TaskStatus }): boolean {
  if (TERMINAL_STATUSES.includes(task.status) || !task.due_date) return false;
  const due = new Date(task.due_date);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

/** Aggregate everything a dashboard renders in a few scoped queries. RLS keeps the
 *  result to what the caller can see (company staff → all; project-scoped → their
 *  projects). `orgId` pins the active company; an optional `projectId` narrows it
 *  to a single project's Overview. */
export async function getDashboardData(orgId: string, projectId?: string): Promise<DashboardData> {
  const supabase = await createClient();

  let tasksQuery = supabase
    .from('tasks')
    .select(
      'id, title, status, sla_status, project_id, assignee_id, planned_start_date, planned_end_date, due_date',
    )
    .eq('org_id', orgId);
  let projectsQuery = supabase.from('projects').select('id, name').eq('org_id', orgId);
  let requestsQuery = supabase
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'submitted');

  if (projectId) {
    tasksQuery = tasksQuery.eq('project_id', projectId);
    projectsQuery = projectsQuery.eq('id', projectId);
    requestsQuery = requestsQuery.eq('project_id', projectId);
  }

  const [tasksRes, projectsRes, openRequestsRes] = await Promise.all([
    tasksQuery.order('created_at', { ascending: true }),
    projectsQuery,
    requestsQuery,
  ]);

  type RawTask = {
    id: string;
    title: string;
    status: TaskStatus;
    sla_status: TaskSlaStatus;
    project_id: string;
    assignee_id: string | null;
    planned_start_date: string | null;
    planned_end_date: string | null;
    due_date: string | null;
  };

  const rawTasks = (tasksRes.data ?? []) as RawTask[];
  const projectNames = new Map(
    ((projectsRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // Resolve assignee display names in one query.
  const assigneeIds = [...new Set(rawTasks.map((t) => t.assignee_id).filter(Boolean))] as string[];
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

  const tasks: DashboardTask[] = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    sla_status: t.sla_status,
    project_id: t.project_id,
    projectName: projectNames.get(t.project_id) ?? 'Project',
    assigneeName: t.assignee_id ? names.get(t.assignee_id) ?? null : null,
    planned_start_date: t.planned_start_date,
    planned_end_date: t.planned_end_date,
    due_date: t.due_date,
  }));

  const counts: DashboardCounts = {
    pendingSignoff: tasks.filter((t) => t.status === 'submitted' || t.sla_status === 'pending_signoff')
      .length,
    blockers: tasks.filter((t) => t.status === 'blocked' || t.sla_status === 'blocked').length,
    breaches: tasks.filter((t) => t.sla_status === 'breached' || isOverdue(t)).length,
    openRequests: openRequestsRes.count ?? 0,
  };

  return { counts, tasks };
}
