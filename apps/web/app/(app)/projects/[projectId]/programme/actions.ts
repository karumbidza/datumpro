'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { computeProjectPlan } from '@/lib/data/schedule-engine';

type Result = { ok: boolean; error?: string };
type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function isBackdated(startDate: string): boolean {
  return startDate < today();
}

const DEP_TYPES = ['fs', 'ss', 'ff', 'sf'] as const;
type DepType = (typeof DEP_TYPES)[number];
function parseType(value: unknown): DepType {
  const v = String(value ?? 'fs');
  return (DEP_TYPES as readonly string[]).includes(v) ? (v as DepType) : 'fs';
}

function revalidate(projectId: string, taskId?: string) {
  revalidatePath(`/projects/${projectId}/programme`);
  revalidatePath(`/projects/${projectId}/calendar`);
  if (taskId) revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

/**
 * Realign the whole programme through the unified working-day CPM engine — the
 * opt-in "auto-schedule" behaviour. Delegates to `computeProjectPlan`, which runs
 * the shared critical-path engine over the project's tasks + dependencies
 * (honouring FS/SS/FF/SF + lag on working days, pinning started tasks and never
 * backdating) and returns each task's planned window as working-day ISO dates.
 * Persists only the windows that actually changed.
 *
 * Returns the number of tasks it shifted. A no-op when auto-schedule is off or the
 * dependency graph has a cycle.
 */
async function cascadeProject(supabase: SupabaseClient, projectId: string): Promise<number> {
  const { data: projectData } = await supabase
    .from('projects')
    .select('auto_schedule')
    .eq('id', projectId)
    .maybeSingle();
  if (!((projectData as { auto_schedule: boolean } | null)?.auto_schedule)) return 0;

  const plan = await computeProjectPlan(supabase, projectId);
  if (plan.length === 0) return 0;

  const { data: storedData } = await supabase
    .from('tasks')
    .select('id, planned_start_date, planned_end_date')
    .in(
      'id',
      plan.map((p) => p.id),
    );
  const stored = new Map<string, { start: string | null; end: string | null }>();
  for (const r of (storedData ?? []) as {
    id: string;
    planned_start_date: string | null;
    planned_end_date: string | null;
  }[]) {
    stored.set(r.id, { start: r.planned_start_date, end: r.planned_end_date });
  }

  let changed = 0;
  for (const { id, start, end } of plan) {
    const current = stored.get(id);
    if (current && start === current.start && end === current.end) continue;
    const { error } = await supabase
      .from('tasks')
      .update({ planned_start_date: start, planned_end_date: end, due_date: end })
      .eq('id', id);
    if (error) {
      console.error(`cascadeProject: failed to update task ${id}`, error.message);
      return changed;
    }
    changed++;
  }
  return changed;
}

/** Move a task's bar on the programme: sets the planned window and keeps the due
 *  date equal to the end (the app-wide "end IS the due date" rule). RLS only lets
 *  a manager (PM / org staff) write, and the no-backdating floor is enforced. When
 *  the project has auto-schedule on, dependents cascade forward afterwards. */
export async function rescheduleTask(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const start = String(formData.get('plannedStartDate') ?? '').trim();
  const end = String(formData.get('plannedEndDate') ?? '').trim();
  if (!taskId || !projectId) return { ok: false, error: 'Missing task.' };
  if (!start || Number.isNaN(Date.parse(start))) return { ok: false, error: 'Pick a start date.' };
  if (!end || Number.isNaN(Date.parse(end))) return { ok: false, error: 'Pick an end date.' };
  if (end < start) return { ok: false, error: 'The end date can’t be before the start.' };
  if (isBackdated(start)) return { ok: false, error: 'The start date can’t be in the past.' };

  const { error } = await supabase
    .from('tasks')
    .update({ planned_start_date: start, planned_end_date: end, due_date: end })
    .eq('id', taskId);
  if (error) return { ok: false, error: error.message };

  await cascadeProject(supabase, projectId);
  revalidate(projectId, taskId);
  return { ok: true };
}

/** Link two tasks: a finish-to-start dependency (predecessor must finish before
 *  successor starts, +lag). The DB cycle trigger blocks loops; RLS blocks
 *  non-managers. Cascades dependents when auto-schedule is on. */
export async function createDependency(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const predecessorId = String(formData.get('predecessorId') ?? '');
  const successorId = String(formData.get('successorId') ?? '');
  const lagRaw = Number(formData.get('lagDays') ?? 0);
  const type = parseType(formData.get('type'));
  if (!projectId || !predecessorId || !successorId) return { ok: false, error: 'Missing task.' };
  if (predecessorId === successorId) return { ok: false, error: 'A task can’t depend on itself.' };

  const { data: taskRow } = await supabase
    .from('tasks')
    .select('org_id')
    .eq('id', successorId)
    .maybeSingle();
  const orgId = (taskRow as { org_id: string } | null)?.org_id;
  if (!orgId) return { ok: false, error: 'Task not found.' };

  const { error } = await supabase.from('task_dependencies').insert({
    org_id: orgId,
    predecessor_id: predecessorId,
    successor_id: successorId,
    lag_days: Number.isFinite(lagRaw) ? Math.trunc(lagRaw) : 0,
    type,
  });
  if (error) {
    if (/circular/i.test(error.message)) return { ok: false, error: 'That would create a circular dependency.' };
    if (/duplicate|unique/i.test(error.message)) return { ok: false, error: 'Those tasks are already linked.' };
    return { ok: false, error: error.message };
  }

  await cascadeProject(supabase, projectId);
  revalidate(projectId);
  return { ok: true };
}

/** Remove a finish-to-start link between two tasks. */
export async function deleteDependency(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const predecessorId = String(formData.get('predecessorId') ?? '');
  const successorId = String(formData.get('successorId') ?? '');
  if (!projectId || !predecessorId || !successorId) return { ok: false, error: 'Missing link.' };

  const { error } = await supabase
    .from('task_dependencies')
    .delete()
    .eq('predecessor_id', predecessorId)
    .eq('successor_id', successorId);
  if (error) return { ok: false, error: error.message };

  revalidate(projectId);
  return { ok: true };
}

/** Change a link's relationship type and/or lag. Cascades when auto-schedule is on. */
export async function updateDependency(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const predecessorId = String(formData.get('predecessorId') ?? '');
  const successorId = String(formData.get('successorId') ?? '');
  const type = parseType(formData.get('type'));
  const lagRaw = Number(formData.get('lagDays') ?? 0);
  if (!projectId || !predecessorId || !successorId) return { ok: false, error: 'Missing link.' };

  const { error } = await supabase
    .from('task_dependencies')
    .update({ type, lag_days: Number.isFinite(lagRaw) ? Math.trunc(lagRaw) : 0 })
    .eq('predecessor_id', predecessorId)
    .eq('successor_id', successorId);
  if (error) return { ok: false, error: error.message };

  await cascadeProject(supabase, projectId);
  revalidate(projectId);
  return { ok: true };
}

/** Persist a new row order for the programme. The client sends the full ordered
 *  list of task ids; each gets a sequential programme_order. RLS restricts writes
 *  to managers. Rescheduling never touches this, so rows stay put until reordered. */
export async function reorderProgramme(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const ids = String(formData.get('orderedIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!projectId || ids.length === 0) return { ok: false, error: 'Missing order.' };

  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from('tasks')
      .update({ programme_order: i + 1 })
      .eq('id', ids[i])
      .eq('project_id', projectId);
    if (error) return { ok: false, error: error.message };
  }

  revalidate(projectId);
  return { ok: true };
}

/** Capture the current plan as the programme baseline (snapshots every scheduled
 *  task's planned window into its baseline columns). Managers only — the RPC
 *  checks can_manage_project. Re-running re-baselines to the current plan. */
export async function setBaseline(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  if (!projectId) return { ok: false, error: 'Missing project.' };

  const { error } = await supabase.rpc('set_project_baseline', { p_project_id: projectId });
  if (error) return { ok: false, error: error.message };

  revalidate(projectId);
  return { ok: true };
}

/**
 * Recompute the WHOLE programme through the unified working-day CPM engine and
 * write it — the manager's explicit "reschedule from today" action. Runs
 * `computeProjectPlan` (FS/SS/FF/SF + lag on working days, started tasks pinned,
 * never backdating) and persists every task's window (planned start/end + due
 * date). Unlike the auto-schedule cascade this ignores the `auto_schedule` gate —
 * it's a deliberate user action. Writes go through the migration-044 DB trigger,
 * which enforces manager-only and surfaces its own error to non-managers. Returns
 * an error if the dependency graph has a cycle.
 */
export async function rescheduleProject(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  if (!projectId) return { ok: false, error: 'Missing project.' };

  const plan = await computeProjectPlan(supabase, projectId);
  if (plan.length === 0) return { ok: false, error: 'Couldn’t schedule — check for a dependency loop.' };

  for (const { id, start, end } of plan) {
    const { error } = await supabase
      .from('tasks')
      .update({ planned_start_date: start, planned_end_date: end, due_date: end })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
  }

  revalidate(projectId);
  return { ok: true };
}

/** Toggle the project's opt-in auto-schedule cascade. RLS restricts to managers. */
export async function setAutoSchedule(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  if (!projectId) return { ok: false, error: 'Missing project.' };

  const { error } = await supabase.from('projects').update({ auto_schedule: enabled }).eq('id', projectId);
  if (error) return { ok: false, error: error.message };

  // Turning it on realigns the existing programme once, immediately.
  if (enabled) await cascadeProject(supabase, projectId);
  revalidate(projectId);
  return { ok: true };
}
