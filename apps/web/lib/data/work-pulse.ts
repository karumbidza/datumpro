import { createClient } from '@/lib/supabase/server';

/** The DB-measured half of the Work Pulse greeting — task, activity and progress
 *  signals for the signed-in user. RLS scopes every row to what they can see, so a
 *  portfolio owner gets org-wide figures and a contractor gets their own. The page
 *  combines these with the approvals count it already has and the user's name. */
export interface WorkPulseSignals {
  overdueTasks: number;
  notStartedTasks: number;
  dueTodayTasks: number;
  dueSoonTasks: number;
  upcomingTasks: number;
  blockedTasks: number;
  completedThisWeek: number;
  recentActivityCount: number;
  userRecentlyActive: boolean;
  activeProjectName: string | null;
  nextDeadlineIso: string | null;
}

const EMPTY: WorkPulseSignals = {
  overdueTasks: 0,
  notStartedTasks: 0,
  dueTodayTasks: 0,
  dueSoonTasks: 0,
  upcomingTasks: 0,
  blockedTasks: 0,
  completedThisWeek: 0,
  recentActivityCount: 0,
  userRecentlyActive: false,
  activeProjectName: null,
  nextDeadlineIso: null,
};

/** Add days to a YYYY-MM-DD string (UTC-based, matching the app's todayIso). */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type ProjJoin = { name: string | null } | { name: string | null }[] | null;
const projName = (p: ProjJoin): string | null => (Array.isArray(p) ? p[0]?.name : p?.name) ?? null;

export async function getWorkPulseSignals(orgId: string, userId: string): Promise<WorkPulseSignals> {
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);
  const in2 = addDaysIso(today, 2);
  const in7 = addDaysIso(today, 7);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();

  const [tasksRes, recentRes, mineRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, status, due_date, planned_start_date, sla_status, assignee_id, actual_end_date, project_id, projects(name)')
      .eq('org_id', orgId),
    supabase
      .from('task_activity')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', threeHoursAgo),
    supabase
      .from('task_activity')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo),
  ]);

  const rows = (tasksRes.data ?? []) as {
    id: string;
    status: string;
    due_date: string | null;
    planned_start_date: string | null;
    sla_status: string | null;
    assignee_id: string | null;
    actual_end_date: string | null;
    project_id: string;
    projects: ProjJoin;
  }[];

  const s: WorkPulseSignals = { ...EMPTY };
  const upcomingByProject = new Map<string, { name: string | null; n: number }>();
  let nextDeadline: string | null = null;

  for (const t of rows) {
    const done = t.status === 'done';
    if (t.status === 'blocked' || t.sla_status === 'blocked') s.blockedTasks++;

    if (done) {
      if (t.assignee_id === userId && t.actual_end_date && t.actual_end_date >= weekAgo) s.completedThisWeek++;
      continue;
    }

    // Should have started — planned start is past but the task is still to-do.
    if (t.status === 'todo' && t.planned_start_date && t.planned_start_date < today) s.notStartedTasks++;

    if (t.due_date) {
      if (t.due_date < today) s.overdueTasks++;
      else if (t.due_date === today) s.dueTodayTasks++;
      else if (t.due_date <= in2) s.dueSoonTasks++;

      if (t.due_date >= today) {
        if (t.due_date <= in7) {
          s.upcomingTasks++;
          const cur = upcomingByProject.get(t.project_id) ?? { name: projName(t.projects), n: 0 };
          cur.n++;
          upcomingByProject.set(t.project_id, cur);
        }
        if (!nextDeadline || t.due_date < nextDeadline) nextDeadline = t.due_date;
      }
    }
  }

  s.nextDeadlineIso = nextDeadline;
  s.recentActivityCount = recentRes.count ?? 0;
  s.userRecentlyActive = (mineRes.count ?? 0) > 0;

  // The project most of the upcoming work sits on — for a project-aware insight.
  let top: { name: string | null; n: number } | null = null;
  for (const v of upcomingByProject.values()) if (!top || v.n > top.n) top = v;
  s.activeProjectName = top?.name ?? null;

  return s;
}
