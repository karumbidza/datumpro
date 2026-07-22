import { createClient } from '@/lib/supabase/server';
import type { OrgRole } from '@datumpro/shared/access';
import { formatUsd } from '@datumpro/shared/domain';

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

export type ApprovalKind = 'signoff' | 'extension' | 'variation';

export interface PendingApproval {
  key: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  projectId: string;
  projectName: string;
  taskId: string | null;
  at: string | null;
}

function impactLabel(cents: number, days: number): string {
  const parts: string[] = [];
  if (cents !== 0) parts.push(`${cents > 0 ? '+' : '−'}${formatUsd(Math.abs(cents))}`);
  if (days !== 0) parts.push(`${days > 0 ? '+' : '−'}${Math.abs(days)}d`);
  return parts.length ? parts.join(' · ') : 'no cost/time change';
}

/** Every decision waiting on the caller — task sign-offs, extension requests and
 *  submitted variations — across the projects they manage, oldest first. One
 *  inbox instead of three scattered surfaces. */
export async function listPendingApprovals(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<PendingApproval[]> {
  const supabase = await createClient();
  const managed = await managedProjectIds(supabase, userId, role);
  if (managed !== 'all' && managed.length === 0) return [];
  const scope: string[] | null = managed === 'all' ? null : managed;

  let taskQ = supabase
    .from('tasks')
    .select('id, title, project_id, assignee_id, submitted_at')
    .eq('org_id', orgId)
    .eq('status', 'submitted');
  if (scope) taskQ = taskQ.in('project_id', scope);

  let extQ = supabase
    .from('task_extension_requests')
    .select('id, task_id, project_id, proposed_due_date, requested_by, created_at')
    .eq('org_id', orgId)
    .eq('status', 'pending');
  if (scope) extQ = extQ.in('project_id', scope);

  let varQ = supabase
    .from('variation_orders')
    .select('id, project_id, description, cost_impact_cents, time_impact_days, created_by, created_at')
    .eq('org_id', orgId)
    .eq('status', 'submitted');
  if (scope) varQ = varQ.in('project_id', scope);

  const [tasksRes, extRes, varRes] = await Promise.all([taskQ, extQ, varQ]);

  const tasks = (tasksRes.data ?? []) as {
    id: string;
    title: string;
    project_id: string;
    assignee_id: string | null;
    submitted_at: string | null;
  }[];
  const exts = (extRes.data ?? []) as {
    id: string;
    task_id: string;
    project_id: string;
    proposed_due_date: string;
    requested_by: string | null;
    created_at: string;
  }[];
  const vars = (varRes.data ?? []) as {
    id: string;
    project_id: string;
    description: string;
    cost_impact_cents: number;
    time_impact_days: number;
    created_by: string | null;
    created_at: string;
  }[];
  if (tasks.length === 0 && exts.length === 0 && vars.length === 0) return [];

  const projectIds = [
    ...new Set([...tasks, ...exts, ...vars].map((r) => r.project_id)),
  ];
  const extTaskIds = [...new Set(exts.map((e) => e.task_id))];
  const userIds = [
    ...new Set(
      [
        ...tasks.map((t) => t.assignee_id),
        ...exts.map((e) => e.requested_by),
        ...vars.map((v) => v.created_by),
      ].filter(Boolean),
    ),
  ] as string[];

  const [projsRes, extTasksRes, profsRes] = await Promise.all([
    supabase.from('projects').select('id, name').in('id', projectIds),
    extTaskIds.length
      ? supabase.from('tasks').select('id, title').in('id', extTaskIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    userIds.length
      ? supabase.from('profiles').select('id, display_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);
  const pName = new Map(((projsRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const tTitle = new Map(((extTasksRes.data ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]));
  const uName = new Map(
    ((profsRes.data ?? []) as { id: string; display_name: string | null }[]).map((u) => [u.id, u.display_name ?? 'Someone']),
  );

  const items: PendingApproval[] = [
    ...tasks.map((t) => ({
      key: `s:${t.id}`,
      kind: 'signoff' as const,
      title: t.title,
      detail: `${t.assignee_id ? uName.get(t.assignee_id) ?? 'Someone' : 'Unassigned'} · submitted for sign-off`,
      projectId: t.project_id,
      projectName: pName.get(t.project_id) ?? 'Project',
      taskId: t.id,
      at: t.submitted_at,
    })),
    ...exts.map((e) => ({
      key: `e:${e.id}`,
      kind: 'extension' as const,
      title: tTitle.get(e.task_id) ?? 'Task',
      detail: `New due ${e.proposed_due_date}${e.requested_by ? ` · ${uName.get(e.requested_by) ?? 'Someone'}` : ''}`,
      projectId: e.project_id,
      projectName: pName.get(e.project_id) ?? 'Project',
      taskId: e.task_id,
      at: e.created_at,
    })),
    ...vars.map((v) => ({
      key: `v:${v.id}`,
      kind: 'variation' as const,
      title: v.description,
      detail: `${impactLabel(v.cost_impact_cents, v.time_impact_days)}${v.created_by ? ` · ${uName.get(v.created_by) ?? 'Someone'}` : ''}`,
      projectId: v.project_id,
      projectName: pName.get(v.project_id) ?? 'Project',
      taskId: null,
      at: v.created_at,
    })),
  ];
  items.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  return items;
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
