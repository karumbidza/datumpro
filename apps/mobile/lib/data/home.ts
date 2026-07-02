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
