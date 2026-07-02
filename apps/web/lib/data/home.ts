import { createClient } from '@/lib/supabase/server';
import type { OrgRole } from '@datumpro/shared/access';

/** Which home a role lands on. Money/company roles get the portfolio; a PM gets
 *  a delivery cockpit; everyone else gets their own work. The approvals inbox is
 *  data-driven on top of this, so a member who happens to be a project PM still
 *  sees pending sign-offs. */
export type HomePersona = 'portfolio' | 'delivery' | 'personal';

export function homePersona(role: OrgRole): HomePersona {
  if (role === 'owner' || role === 'admin' || role === 'finance') return 'portfolio';
  if (role === 'pm') return 'delivery';
  return 'personal';
}

/** Projects the caller may manage: owner/admin → all in the org; anyone else →
 *  the projects where they hold the project PM seat. Mirrors can_manage_project. */
async function managedProjectIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  role: OrgRole,
): Promise<string[] | 'all'> {
  if (role === 'owner' || role === 'admin') return 'all';
  const { data } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)
    .eq('role', 'pm');
  return ((data ?? []) as { project_id: string }[]).map((r) => r.project_id);
}

export interface SignoffItem {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  assigneeName: string;
  submittedAt: string | null;
}

/** Tasks awaiting sign-off that the caller can actually approve. */
export async function listPendingSignoffs(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<SignoffItem[]> {
  const supabase = await createClient();
  const managed = await managedProjectIds(supabase, userId, role);
  if (managed !== 'all' && managed.length === 0) return [];

  let q = supabase
    .from('tasks')
    .select('id, title, project_id, assignee_id, submitted_at')
    .eq('org_id', orgId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true });
  if (managed !== 'all') q = q.in('project_id', managed);
  const { data } = await q;
  const rows = (data ?? []) as {
    id: string;
    title: string;
    project_id: string;
    assignee_id: string | null;
    submitted_at: string | null;
  }[];
  if (rows.length === 0) return [];

  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const userIds = [...new Set(rows.map((r) => r.assignee_id).filter(Boolean))] as string[];
  const [{ data: projs }, profsRes] = await Promise.all([
    supabase.from('projects').select('id, name').in('id', projectIds),
    userIds.length
      ? supabase.from('profiles').select('id, display_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);
  const pName = new Map(((projs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const uName = new Map(
    ((profsRes.data ?? []) as { id: string; display_name: string | null }[]).map((u) => [u.id, u.display_name]),
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    projectName: pName.get(r.project_id) ?? 'Project',
    assigneeName: r.assignee_id ? uName.get(r.assignee_id) ?? 'Someone' : 'Unassigned',
    submittedAt: r.submitted_at,
  }));
}

export interface MyTaskItem {
  id: string;
  title: string;
  projectId: string;
  status: string;
  dueDate: string | null;
  slaStatus: string;
}

/** The caller's own open (not done) tasks, soonest due first. */
export async function listMyOpenTasks(userId: string): Promise<MyTaskItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tasks')
    .select('id, title, project_id, status, due_date, sla_status')
    .eq('assignee_id', userId)
    .neq('status', 'done')
    .order('due_date', { ascending: true, nullsFirst: false });
  return ((data ?? []) as {
    id: string;
    title: string;
    project_id: string;
    status: string;
    due_date: string | null;
    sla_status: string;
  }[]).map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    status: r.status,
    dueDate: r.due_date,
    slaStatus: r.sla_status,
  }));
}

export interface ManagedProject {
  id: string;
  name: string;
  done: number;
  total: number;
}

/** Projects the caller runs, with a done/total task count for a progress read. */
export async function listManagedProjects(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<ManagedProject[]> {
  const supabase = await createClient();
  const managed = await managedProjectIds(supabase, userId, role);
  if (managed !== 'all' && managed.length === 0) return [];

  let pq = supabase
    .from('projects')
    .select('id, name')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (managed !== 'all') pq = pq.in('id', managed);
  const { data: projs } = await pq;
  const projects = (projs ?? []) as { id: string; name: string }[];
  if (projects.length === 0) return [];

  const ids = projects.map((p) => p.id);
  const { data: taskRows } = await supabase.from('tasks').select('project_id, status').in('project_id', ids);
  const agg = new Map<string, { done: number; total: number }>();
  for (const p of projects) agg.set(p.id, { done: 0, total: 0 });
  for (const t of (taskRows ?? []) as { project_id: string; status: string }[]) {
    const a = agg.get(t.project_id);
    if (!a) continue;
    a.total += 1;
    if (t.status === 'done') a.done += 1;
  }
  return projects.map((p) => ({ id: p.id, name: p.name, ...(agg.get(p.id) ?? { done: 0, total: 0 }) }));
}
