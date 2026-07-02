import { supabase } from '../supabase';

export interface ProjectProgress {
  id: string;
  name: string;
  total: number;
  done: number;
  pct: number;
}

export interface HomeData {
  displayName: string;
  projects: ProjectProgress[];
  portfolioPct: number;
  totalTasks: number;
  doneTasks: number;
  myOpen: number;
  myOverdue: number;
  myAtRisk: number;
}

export interface PendingSignoff {
  id: string;
  title: string;
  projectName: string;
  assigneeName: string;
}

/** Tasks awaiting the current user's sign-off — submitted tasks on projects
 *  where they're the project PM, plus every submitted task in orgs where they're
 *  owner/admin. Mirrors can_manage_project; each row deep-links to the task,
 *  where Approve/Reject already live. Empty for pure field users. */
export async function listPendingSignoffs(): Promise<PendingSignoff[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user?.id;
  if (!me) return [];

  const [{ data: pmRows }, { data: adminRows }] = await Promise.all([
    supabase.from('project_members').select('project_id').eq('user_id', me).eq('role', 'pm'),
    supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', me)
      .eq('status', 'active')
      .in('role', ['owner', 'admin']),
  ]);
  const pmProjects = ((pmRows ?? []) as { project_id: string }[]).map((r) => r.project_id);
  const adminOrgs = ((adminRows ?? []) as { org_id: string }[]).map((r) => r.org_id);
  if (pmProjects.length === 0 && adminOrgs.length === 0) return [];

  const ors: string[] = [];
  if (pmProjects.length) ors.push(`project_id.in.(${pmProjects.join(',')})`);
  if (adminOrgs.length) ors.push(`org_id.in.(${adminOrgs.join(',')})`);

  const { data } = await supabase
    .from('tasks')
    .select('id, title, project_id, assignee_id')
    .eq('status', 'submitted')
    .or(ors.join(','))
    .order('submitted_at', { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    title: string;
    project_id: string;
    assignee_id: string | null;
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
    projectName: pName.get(r.project_id) ?? 'Project',
    assigneeName: r.assignee_id ? uName.get(r.assignee_id) ?? 'Someone' : 'Unassigned',
  }));
}

/** One round-trip of everything the Home dashboard needs. RLS scopes the rows to
 *  what this user may see, so the same query naturally adapts to their role:
 *  a manager sees every project's tasks, a foreman only their own. */
export async function getHomeData(): Promise<HomeData> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user?.id ?? '';
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: profile }, { data: projectRows }, { data: taskRows }] = await Promise.all([
    supabase.from('profiles').select('display_name, email').eq('id', me).maybeSingle(),
    supabase.from('projects').select('id, name').order('created_at', { ascending: false }),
    supabase.from('tasks').select('id, status, sla_status, due_date, project_id, assignee_id'),
  ]);

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
    projects: projectProgress,
    portfolioPct: totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100),
    totalTasks,
    doneTasks,
    myOpen,
    myOverdue,
    myAtRisk,
  };
}
