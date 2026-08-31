'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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

// UTC-based date arithmetic on YYYY-MM-DD strings, so day shifts never drift
// across timezones (mirrors the rest of the scheduling code).
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
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
 * Cascade dependents forward so no successor starts before its predecessor
 * finishes (+lag) — the opt-in "auto-schedule" behaviour. Finish-to-start only,
 * calendar days, bars inclusive: a successor may start the day AFTER the
 * predecessor's end, plus its lag. Only tasks with a real planned window are
 * moved; durations are preserved. A pass cap guards against a bad-data loop
 * (the DB cycle trigger already blocks true cycles at insert time).
 *
 * Returns the number of tasks it shifted. A no-op when auto-schedule is off.
 */
async function cascadeProject(supabase: SupabaseClient, projectId: string): Promise<number> {
  const { data: projectData } = await supabase
    .from('projects')
    .select('auto_schedule')
    .eq('id', projectId)
    .maybeSingle();
  if (!((projectData as { auto_schedule: boolean } | null)?.auto_schedule)) return 0;

  const { data: taskData } = await supabase
    .from('tasks')
    .select('id, planned_start_date, planned_end_date, due_date')
    .eq('project_id', projectId);
  const rows = (taskData ?? []) as {
    id: string;
    planned_start_date: string | null;
    planned_end_date: string | null;
    due_date: string | null;
  }[];
  if (rows.length === 0) return 0;

  const ids = rows.map((r) => r.id);
  const { data: depData } = await supabase
    .from('task_dependencies')
    .select('predecessor_id, successor_id, lag_days, type')
    .in('successor_id', ids);
  const edges = (depData ?? []) as { predecessor_id: string; successor_id: string; lag_days: number; type: string | null }[];
  if (edges.length === 0) return 0;

  // Working window per task: only fully-planned tasks are movable.
  type Win = { start: string; end: string; scheduled: boolean };
  const win = new Map<string, Win>();
  for (const r of rows) {
    const end = r.planned_end_date ?? r.due_date;
    if (r.planned_start_date && end) {
      win.set(r.id, { start: r.planned_start_date, end: end < r.planned_start_date ? r.planned_start_date : end, scheduled: !!r.planned_end_date });
    } else if (end) {
      win.set(r.id, { start: end, end, scheduled: false });
    }
  }

  const shifted = new Set<string>();
  const maxPasses = rows.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const e of edges) {
      const pred = win.get(e.predecessor_id);
      const succ = win.get(e.successor_id);
      if (!pred || !succ || !succ.scheduled) continue; // only move real windows
      const lag = e.lag_days || 0;
      const type = e.type ?? 'fs';
      // Each type constrains a different successor anchor. fs/ss pin the start;
      // ff/sf pin the finish. Shift the successor forward (preserving duration)
      // only when its anchor sits earlier than the relationship allows.
      let delta = 0;
      if (type === 'ss') {
        const minStart = shiftIso(pred.start, lag);
        if (succ.start < minStart) delta = diffDays(minStart, succ.start);
      } else if (type === 'ff') {
        const minEnd = shiftIso(pred.end, lag);
        if (succ.end < minEnd) delta = diffDays(minEnd, succ.end);
      } else if (type === 'sf') {
        const minEnd = shiftIso(pred.start, lag);
        if (succ.end < minEnd) delta = diffDays(minEnd, succ.end);
      } else {
        const minStart = shiftIso(pred.end, 1 + lag);
        if (succ.start < minStart) delta = diffDays(minStart, succ.start);
      }
      if (delta > 0) {
        succ.start = shiftIso(succ.start, delta);
        succ.end = shiftIso(succ.end, delta);
        shifted.add(e.successor_id);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const id of shifted) {
    const w = win.get(id)!;
    await supabase
      .from('tasks')
      .update({ planned_start_date: w.start, planned_end_date: w.end, due_date: w.end })
      .eq('id', id);
  }
  return shifted.size;
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
