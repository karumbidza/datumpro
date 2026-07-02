import { supabase } from '../supabase';

export interface MyTask {
  id: string;
  title: string;
  status: string;
  slaStatus: string;
  dueDate: string | null;
  priority: string;
  projectId: string;
  projectName: string;
}

export interface TaskDetail extends MyTask {
  orgId: string;
  description: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
}

type ProjectJoin = { name: string | null } | { name: string | null }[] | null;
function projectName(p: ProjectJoin): string {
  const row = Array.isArray(p) ? p[0] : p;
  return row?.name ?? 'Project';
}

/** Tasks assigned to the signed-in user (all states, soonest due first). RLS
 *  scopes it; the Tasks screen filters by state client-side. */
export async function listMyTasks(): Promise<MyTask[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('tasks')
    .select('id, title, status, sla_status, due_date, priority, project_id, projects(name)')
    .eq('assignee_id', user.id)
    .order('due_date', { ascending: true, nullsFirst: false });

  return ((data ?? []) as {
    id: string;
    title: string;
    status: string;
    sla_status: string;
    due_date: string | null;
    priority: string;
    project_id: string;
    projects: ProjectJoin;
  }[]).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    slaStatus: t.sla_status,
    dueDate: t.due_date,
    priority: t.priority,
    projectId: t.project_id,
    projectName: projectName(t.projects),
  }));
}

/** Every task in a project (RLS-scoped: managers/PMs see all, members see the
 *  project's tasks). Ordered by due date. */
export async function listProjectTasks(projectId: string): Promise<MyTask[]> {
  const { data } = await supabase
    .from('tasks')
    .select('id, title, status, sla_status, due_date, priority, project_id, projects(name)')
    .eq('project_id', projectId)
    .order('due_date', { ascending: true, nullsFirst: false });

  return ((data ?? []) as {
    id: string;
    title: string;
    status: string;
    sla_status: string;
    due_date: string | null;
    priority: string;
    project_id: string;
    projects: ProjectJoin;
  }[]).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    slaStatus: t.sla_status,
    dueDate: t.due_date,
    priority: t.priority,
    projectId: t.project_id,
    projectName: projectName(t.projects),
  }));
}

/** A single task's detail (RLS-scoped). */
export async function getTask(id: string): Promise<TaskDetail | null> {
  const { data } = await supabase
    .from('tasks')
    .select(
      'id, org_id, title, description, status, sla_status, due_date, priority, project_id, planned_start_date, planned_end_date, projects(name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const t = data as {
    id: string;
    org_id: string;
    title: string;
    description: string | null;
    status: string;
    sla_status: string;
    due_date: string | null;
    priority: string;
    project_id: string;
    planned_start_date: string | null;
    planned_end_date: string | null;
    projects: ProjectJoin;
  };
  return {
    id: t.id,
    orgId: t.org_id,
    title: t.title,
    description: t.description,
    status: t.status,
    slaStatus: t.sla_status,
    dueDate: t.due_date,
    priority: t.priority,
    projectId: t.project_id,
    projectName: projectName(t.projects),
    plannedStartDate: t.planned_start_date,
    plannedEndDate: t.planned_end_date,
  };
}
