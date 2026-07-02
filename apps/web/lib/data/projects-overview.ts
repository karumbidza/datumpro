import { createClient } from '@/lib/supabase/server';
import type { ProjectStatus } from '@datumpro/shared/domain';

export interface OverviewMilestone {
  id: string;
  name: string;
  targetDate: string | null;
  status: 'pending' | 'in_progress' | 'done' | 'missed';
  /** Position 0–100 along the project timeline (by target date). */
  position: number;
}

export interface ProjectOverview {
  id: string;
  name: string;
  clientName: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  contractValueCents: number;
  totalTasks: number;
  doneTasks: number;
  completionPct: number;
  milestones: OverviewMilestone[];
  nextMilestone: OverviewMilestone | null;
}

/** Portfolio overview: each project with its completion, timeline dates, and
 *  milestones positioned along the timeline. RLS scopes to what the user may see. */
export async function listProjectsOverview(): Promise<ProjectOverview[]> {
  const supabase = await createClient();
  const { data: projectRows } = await supabase
    .from('projects')
    .select('id, name, client_name, status, contract_value_cents, start_date, end_date')
    .order('created_at', { ascending: false });
  const projects = (projectRows ?? []) as {
    id: string;
    name: string;
    client_name: string | null;
    status: ProjectStatus;
    contract_value_cents: number;
    start_date: string | null;
    end_date: string | null;
  }[];
  if (projects.length === 0) return [];

  const ids = projects.map((p) => p.id);
  const [{ data: taskRows }, { data: milestoneRows }] = await Promise.all([
    supabase.from('tasks').select('project_id, status').in('project_id', ids),
    supabase
      .from('milestones')
      .select('id, project_id, name, target_date, status')
      .in('project_id', ids)
      .order('target_date', { ascending: true, nullsFirst: false }),
  ]);

  const tasks = (taskRows ?? []) as { project_id: string; status: string }[];
  const milestones = (milestoneRows ?? []) as {
    id: string;
    project_id: string;
    name: string;
    target_date: string | null;
    status: OverviewMilestone['status'];
  }[];

  const taskAgg = new Map<string, { total: number; done: number }>();
  for (const t of tasks) {
    const a = taskAgg.get(t.project_id) ?? { total: 0, done: 0 };
    a.total += 1;
    if (t.status === 'done') a.done += 1;
    taskAgg.set(t.project_id, a);
  }

  const milestonesByProject = new Map<string, typeof milestones>();
  for (const m of milestones) {
    const list = milestonesByProject.get(m.project_id) ?? [];
    list.push(m);
    milestonesByProject.set(m.project_id, list);
  }

  return projects.map((p) => {
    const agg = taskAgg.get(p.id) ?? { total: 0, done: 0 };
    const completionPct = agg.total === 0 ? 0 : Math.round((agg.done / agg.total) * 100);
    const raw = milestonesByProject.get(p.id) ?? [];

    const positioned: OverviewMilestone[] = raw.map((m) => ({
      id: m.id,
      name: m.name,
      targetDate: m.target_date,
      status: m.status,
      position: timelinePosition(m.target_date, p.start_date, p.end_date),
    }));
    const nextMilestone =
      positioned.find((m) => m.status === 'pending' || m.status === 'in_progress') ?? null;

    return {
      id: p.id,
      name: p.name,
      clientName: p.client_name,
      status: p.status,
      startDate: p.start_date,
      endDate: p.end_date,
      contractValueCents: p.contract_value_cents,
      totalTasks: agg.total,
      doneTasks: agg.done,
      completionPct,
      milestones: positioned,
      nextMilestone,
    };
  });
}

/** Where a milestone sits (0–100) between project start and end by date. Falls
 *  back to spreading evenly when the timeline is unknown. */
function timelinePosition(target: string | null, start: string | null, end: string | null): number {
  if (!target || !start || !end) return 50;
  const t = new Date(target).getTime();
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!(e > s)) return 50;
  return Math.max(2, Math.min(98, Math.round(((t - s) / (e - s)) * 100)));
}
