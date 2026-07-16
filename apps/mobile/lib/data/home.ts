import { supabase, currentUser} from '../supabase';

export interface ProjectProgress {
  id: string;
  name: string;
  total: number;
  done: number;
  pct: number;
}

export interface HomeData {
  displayName: string;
  /** True when the viewer runs anything — org owner/admin/PM, or the PM of any
   *  project. Drives manager vs field-worker framing on the Home screen. */
  isManager: boolean;
  projects: ProjectProgress[];
  portfolioPct: number;
  totalTasks: number;
  doneTasks: number;
  myOpen: number;
  myOverdue: number;
  myAtRisk: number;
}

export type ApprovalKind = 'signoff' | 'extension' | 'variation';

export interface PendingApproval {
  key: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  projectName: string;
  taskId: string | null;
  projectId: string;
}

function impactLabel(cents: number, days: number): string {
  const parts: string[] = [];
  if (cents !== 0) parts.push(`${cents > 0 ? '+' : '−'}$${(Math.abs(cents) / 100).toLocaleString()}`);
  if (days !== 0) parts.push(`${days > 0 ? '+' : '−'}${Math.abs(days)}d`);
  return parts.length ? parts.join(' · ') : 'no cost/time change';
}

/** Every decision waiting on the current user — task sign-offs, extension
 *  requests and submitted variations — on the projects they manage (project PM,
 *  or every project in orgs where they're owner/admin). Empty for field users. */
export async function listPendingApprovals(): Promise<PendingApproval[]> {
  const user = await currentUser();
  const me = user?.id;
  if (!me) return [];

  const [{ data: pmRows }, { data: adminRows }] = await Promise.all([
    supabase.from('project_members').select('project_id').eq('user_id', me).eq('role', 'pm'),
    supabase.from('org_members').select('org_id').eq('user_id', me).eq('status', 'active').in('role', ['owner', 'admin']),
  ]);
  const pmProjects = ((pmRows ?? []) as { project_id: string }[]).map((r) => r.project_id);
  const adminOrgs = ((adminRows ?? []) as { org_id: string }[]).map((r) => r.org_id);
  if (pmProjects.length === 0 && adminOrgs.length === 0) return [];

  const ors: string[] = [];
  if (pmProjects.length) ors.push(`project_id.in.(${pmProjects.join(',')})`);
  if (adminOrgs.length) ors.push(`org_id.in.(${adminOrgs.join(',')})`);
  const or = ors.join(',');

  const [tasksRes, extRes, varRes] = await Promise.all([
    supabase.from('tasks').select('id, title, project_id, assignee_id, submitted_at').eq('status', 'submitted').or(or),
    supabase
      .from('task_extension_requests')
      .select('id, task_id, project_id, proposed_due_date, requested_by, created_at')
      .eq('status', 'pending')
      .or(or),
    supabase
      .from('variation_orders')
      .select('id, project_id, description, cost_impact_cents, time_impact_days, created_by, created_at')
      .eq('status', 'submitted')
      .or(or),
  ]);
  const tasks = (tasksRes.data ?? []) as { id: string; title: string; project_id: string; assignee_id: string | null; submitted_at: string | null }[];
  const exts = (extRes.data ?? []) as { id: string; task_id: string; project_id: string; proposed_due_date: string; requested_by: string | null; created_at: string }[];
  const vars = (varRes.data ?? []) as { id: string; project_id: string; description: string; cost_impact_cents: number; time_impact_days: number; created_by: string | null; created_at: string }[];
  if (tasks.length === 0 && exts.length === 0 && vars.length === 0) return [];

  const projectIds = [...new Set([...tasks, ...exts, ...vars].map((r) => r.project_id))];
  const extTaskIds = [...new Set(exts.map((e) => e.task_id))];
  const userIds = [
    ...new Set([...tasks.map((t) => t.assignee_id), ...exts.map((e) => e.requested_by), ...vars.map((v) => v.created_by)].filter(Boolean)),
  ] as string[];

  const [projsRes, extTasksRes, profsRes] = await Promise.all([
    supabase.from('projects').select('id, name').in('id', projectIds),
    extTaskIds.length ? supabase.from('tasks').select('id, title').in('id', extTaskIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    userIds.length ? supabase.from('profiles').select('id, display_name').in('id', userIds) : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);
  const pName = new Map(((projsRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const tTitle = new Map(((extTasksRes.data ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]));
  const uName = new Map(((profsRes.data ?? []) as { id: string; display_name: string | null }[]).map((u) => [u.id, u.display_name ?? 'Someone']));

  const items: PendingApproval[] = [
    ...tasks.map((t) => ({
      key: `s:${t.id}`,
      kind: 'signoff' as const,
      title: t.title,
      detail: `${t.assignee_id ? uName.get(t.assignee_id) ?? 'Someone' : 'Unassigned'} · submitted for sign-off`,
      projectName: pName.get(t.project_id) ?? 'Project',
      taskId: t.id,
      projectId: t.project_id,
    })),
    ...exts.map((e) => ({
      key: `e:${e.id}`,
      kind: 'extension' as const,
      title: tTitle.get(e.task_id) ?? 'Task',
      detail: `New due ${e.proposed_due_date}${e.requested_by ? ` · ${uName.get(e.requested_by) ?? 'Someone'}` : ''}`,
      projectName: pName.get(e.project_id) ?? 'Project',
      taskId: e.task_id,
      projectId: e.project_id,
    })),
    ...vars.map((v) => ({
      key: `v:${v.id}`,
      kind: 'variation' as const,
      title: v.description,
      detail: `${impactLabel(v.cost_impact_cents, v.time_impact_days)}${v.created_by ? ` · ${uName.get(v.created_by) ?? 'Someone'}` : ''}`,
      projectName: pName.get(v.project_id) ?? 'Project',
      taskId: null,
      projectId: v.project_id,
    })),
  ];
  return items;
}

/** One round-trip of everything the Home dashboard needs. RLS scopes the rows to
 *  what this user may see, so the same query naturally adapts to their role:
 *  a manager sees every project's tasks, a foreman only their own. */
export async function getHomeData(): Promise<HomeData> {
  const user = await currentUser();
  const me = user?.id ?? '';
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: profile }, { data: projectRows }, { data: taskRows }, { data: orgRoles }, { data: pmSeats }] =
    await Promise.all([
      supabase.from('profiles').select('display_name, email').eq('id', me).maybeSingle(),
      supabase.from('projects').select('id, name').order('created_at', { ascending: false }),
      supabase.from('tasks').select('id, status, sla_status, due_date, project_id, assignee_id'),
      supabase.from('org_members').select('role').eq('user_id', me).eq('status', 'active'),
      supabase.from('project_members').select('project_id').eq('user_id', me).eq('role', 'pm').limit(1),
    ]);

  const isManager =
    ((orgRoles ?? []) as { role: string }[]).some((r) => ['owner', 'admin', 'pm'].includes(r.role)) ||
    ((pmSeats ?? []) as { project_id: string }[]).length > 0;

  const projects = (projectRows ?? []) as { id: string; name: string }[];
  const tasks = (taskRows ?? []) as {
    id: string;
    status: string;
    sla_status: string;
    due_date: string | null;
    project_id: string;
    assignee_id: string | null;
  }[];

  const byProject = new Map<string, { total: number; done: number }>();
  for (const p of projects) byProject.set(p.id, { total: 0, done: 0 });
  let totalTasks = 0;
  let doneTasks = 0;
  let myOpen = 0;
  let myOverdue = 0;
  let myAtRisk = 0;

  for (const t of tasks) {
    const agg = byProject.get(t.project_id);
    if (agg) {
      agg.total += 1;
      if (t.status === 'done') agg.done += 1;
    }
    totalTasks += 1;
    if (t.status === 'done') doneTasks += 1;

    if (t.assignee_id === me && t.status !== 'done') {
      myOpen += 1;
      if (t.due_date && t.due_date < today) myOverdue += 1;
      if (t.sla_status === 'at_risk' || t.sla_status === 'breached') myAtRisk += 1;
    }
  }

  const projectProgress: ProjectProgress[] = projects.map((p) => {
    const agg = byProject.get(p.id) ?? { total: 0, done: 0 };
    return {
      id: p.id,
      name: p.name,
      total: agg.total,
      done: agg.done,
      pct: agg.total === 0 ? 0 : Math.round((agg.done / agg.total) * 100),
    };
  });

  const p = profile as { display_name: string | null; email: string | null } | null;
  const displayName = p?.display_name || p?.email?.split('@')[0] || 'there';

  return {
    displayName,
    isManager,
    projects: projectProgress,
    portfolioPct: totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100),
    totalTasks,
    doneTasks,
    myOpen,
    myOverdue,
    myAtRisk,
  };
}
