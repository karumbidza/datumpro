import { createClient } from '@/lib/supabase/server';
import type { TaskStatus, TaskPriority, TaskSlaStatus } from '@datumpro/shared/domain';

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
  created_at: string;
}

const TASK_COLUMNS =
  'id, org_id, project_id, title, description, status, priority, sla_status, assignee_id, due_date, planned_start_date, planned_end_date, blocker_description, completion_notes, rejection_reason, created_at';

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
