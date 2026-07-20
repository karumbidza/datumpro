import { createClient } from '@/lib/supabase/server';
import type { TaskStatus, TaskPriority, TaskSlaStatus } from '@datumpro/shared/domain';

export interface TaskDependencyRow {
  id: string;
  predecessorId: string;
  title: string;
  status: TaskStatus;
  lagDays: number;
}

export interface TaskOption {
  id: string;
  title: string;
}

export interface TaskActivityRow {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  userName: string;
}

export interface ExtensionRequestRow {
  id: string;
  proposedDueDate: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requesterName: string | null;
  createdAt: string;
}

export interface TaskRow {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  sla_status: TaskSlaStatus;
  assignee_id: string | null;
  due_date: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  blocker_description: string | null;
  completion_notes: string | null;
  rejection_reason: string | null;
  acceptance_status: 'pending' | 'accepted' | 'rejected' | null;
  plan_submitted_at: string | null;
  plan_approved_at: string | null;
  awarded_cost_cents: number | null;
  created_at: string;
}

const TASK_COLUMNS =
  'id, org_id, project_id, title, description, status, priority, sla_status, assignee_id, due_date, planned_start_date, planned_end_date, blocker_description, completion_notes, rejection_reason, acceptance_status, plan_submitted_at, plan_approved_at, awarded_cost_cents, created_at';

export async function listTasksByProject(projectId: string): Promise<TaskRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TaskRow[];
}

export async function getTask(taskId: string): Promise<TaskRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw error;
  return (data as TaskRow | null) ?? null;
}

export interface OrgMember {
  userId: string;
  role: string;
  name: string;
}

/** Active members of an org with display names. Two queries because org_members
 *  and profiles both reference auth.users (no direct FK to embed). */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from('org_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (error) throw error;
  const rows = (members ?? []) as { user_id: string; role: string }[];
  if (rows.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, email')
    .in('id', rows.map((m) => m.user_id));
  const byId = new Map(
    ((profiles ?? []) as { id: string; display_name: string | null; email: string | null }[]).map(
      (p) => [p.id, p.display_name || p.email || 'Member'],
    ),
  );
  return rows.map((m) => ({ userId: m.user_id, role: m.role, name: byId.get(m.user_id) ?? 'Member' }));
}

/** The caller's role in an org (for showing role-appropriate actions; the DB
 *  enforces the real rules). */
export async function myOrgRole(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  return (data as { role: string } | null)?.role ?? null;
}

/** Predecessors of a task — the tasks that must complete (plus lag) before it.
 *  Two queries: the edges, then the predecessor tasks' titles/status. */
export async function listTaskDependencies(taskId: string): Promise<TaskDependencyRow[]> {
  const supabase = await createClient();
  const { data: edges, error } = await supabase
    .from('task_dependencies')
    .select('id, predecessor_id, lag_days')
    .eq('successor_id', taskId);
  if (error) throw error;
  const rows = (edges ?? []) as { id: string; predecessor_id: string; lag_days: number }[];
  if (rows.length === 0) return [];

  const { data: preds } = await supabase
    .from('tasks')
    .select('id, title, status')
    .in('id', rows.map((r) => r.predecessor_id));
  const byId = new Map(
    ((preds ?? []) as { id: string; title: string; status: TaskStatus }[]).map((p) => [p.id, p]),
  );
  return rows.map((r) => ({
    id: r.id,
    predecessorId: r.predecessor_id,
    title: byId.get(r.predecessor_id)?.title ?? 'Task',
    status: byId.get(r.predecessor_id)?.status ?? 'todo',
    lagDays: r.lag_days,
  }));
}

/** Other tasks in the project — candidate predecessors for a new dependency. */
export async function listProjectTaskOptions(
  projectId: string,
  excludeTaskId: string,
): Promise<TaskOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('project_id', projectId)
    .neq('id', excludeTaskId)
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TaskOption[];
}

/** Task timeline/audit entries, newest first, with actor names. */
export async function listTaskActivity(taskId: string): Promise<TaskActivityRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('task_activity')
    .select('id, type, message, created_at, user_id')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    type: string;
    message: string;
    created_at: string;
    user_id: string | null;
  }[];
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', ids);
    names = new Map(
      ((profiles ?? []) as { id: string; display_name: string | null; email: string | null }[]).map(
        (p) => [p.id, p.display_name || p.email || 'Member'],
      ),
    );
  }
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    message: r.message,
    createdAt: r.created_at,
    userName: r.user_id ? names.get(r.user_id) ?? 'Member' : 'System',
  }));
}

/** Extension requests on a task, newest first, with requester names. */
export async function listExtensionRequests(taskId: string): Promise<ExtensionRequestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('task_extension_requests')
    .select('id, proposed_due_date, reason, status, requested_by, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    proposed_due_date: string;
    reason: string | null;
    status: ExtensionRequestRow['status'];
    requested_by: string | null;
    created_at: string;
  }[];
  const ids = [...new Set(rows.map((r) => r.requested_by).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', ids);
    names = new Map(
      ((profiles ?? []) as { id: string; display_name: string | null; email: string | null }[]).map(
        (p) => [p.id, p.display_name || p.email || 'Member'],
      ),
    );
  }
  return rows.map((r) => ({
    id: r.id,
    proposedDueDate: r.proposed_due_date,
    reason: r.reason,
    status: r.status,
    requesterName: r.requested_by ? names.get(r.requested_by) ?? null : null,
    createdAt: r.created_at,
  }));
}
