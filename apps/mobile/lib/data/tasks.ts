import { supabase, currentUser} from '../supabase';

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
  assigneeId: string | null;
  requiresPhoto: boolean;
  description: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
}

/** The current user's role relative to a task's project — drives which actions
 *  (start/submit vs approve/reject) are offered. */
export interface TaskPermissions {
  isAssignee: boolean;
  canManage: boolean; // org owner/admin, or the project's PM
}

/** Can the current user manage (create/assign/approve) in this project? */
export async function canManageProject(orgId: string, projectId: string): Promise<boolean> {
  const user = await currentUser();
  const me = user?.id ?? '';
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', me).maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me).maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

/** canManageProject, but looks up the org from the project id first. */
export async function canManageProjectById(projectId: string): Promise<boolean> {
  const { data } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  const orgId = (data as { org_id: string } | null)?.org_id;
  if (!orgId) return false;
  return canManageProject(orgId, projectId);
}

export async function getTaskPermissions(
  orgId: string,
  projectId: string,
  assigneeId: string | null,
): Promise<TaskPermissions> {
  const user = await currentUser();
  const me = user?.id ?? null;
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', me ?? '').maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me ?? '').maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return {
    isAssignee: !!me && assigneeId === me,
    canManage: orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm',
  };
}

type ProjectJoin = { name: string | null } | { name: string | null }[] | null;
function projectName(p: ProjectJoin): string {
  const row = Array.isArray(p) ? p[0] : p;
  return row?.name ?? 'Project';
}

/** Tasks assigned to the signed-in user (all states, soonest due first). RLS
 *  scopes it; the Tasks screen filters by state client-side. */
export async function listMyTasks(): Promise<MyTask[]> {
  const user = await currentUser();
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
      'id, org_id, title, description, status, sla_status, due_date, priority, project_id, assignee_id, requires_photo_on_complete, planned_start_date, planned_end_date, acceptance_status, projects(name)',
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
    assignee_id: string | null;
    requires_photo_on_complete: boolean | null;
    planned_start_date: string | null;
    planned_end_date: string | null;
    acceptance_status: 'pending' | 'accepted' | 'rejected' | null;
    projects: ProjectJoin;
  };
  return {
    id: t.id,
    orgId: t.org_id,
    assigneeId: t.assignee_id,
    requiresPhoto: !!t.requires_photo_on_complete,
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
    acceptanceStatus: t.acceptance_status,
  };
}
