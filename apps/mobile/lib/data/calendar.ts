import { supabase } from '../supabase';

export type CalendarKind = 'task' | 'todo' | 'event' | 'rfi' | 'snag' | 'transmittal';

/** One dated thing on a project's calendar, normalised across tasks, to-dos,
 *  events and the registers. `deadline` items can be overdue; `done` mutes them. */
export interface CalendarItem {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CalendarKind;
  title: string;
  subtitle: string | null;
  deadline: boolean;
  done: boolean;
  /** Where tapping navigates: a task id (task detail) or a project register. */
  taskId: string | null;
}

/** Local calendar day (YYYY-MM-DD) — NOT UTC, so day bucketing tracks the device
 *  timezone (matters for timed events and the today/overdue boundary). */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/** Every dated item on a project, aggregated for the calendar. RLS scopes each read.
 *  Tasks/to-dos use their due date; RFIs & snags their open response deadline;
 *  transmittals their issue date; events their start. Returns the full set sorted
 *  by date so the month grid can dot every day; the screen derives the upcoming
 *  agenda and per-day views from it. */
export async function listProjectCalendar(projectId: string): Promise<CalendarItem[]> {
  const [taskRes, todoRes, eventRes, rfiRes, snagRes, trRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, planned_end_date, due_date')
      .eq('project_id', projectId),
    supabase
      .from('action_items')
      .select('id, title, status, due_date')
      .eq('project_id', projectId)
      .not('due_date', 'is', null),
    supabase
      .from('project_events')
      .select('id, title, kind, location, starts_at, status')
      .eq('project_id', projectId)
      .eq('status', 'scheduled'),
    supabase
      .from('rfis')
      .select('id, number, subject, due_date, status')
      .eq('project_id', projectId)
      .in('status', ['open', 'reopened'])
      .not('due_date', 'is', null),
    supabase
      .from('snags')
      .select('id, number, title, location, due_date, status')
      .eq('project_id', projectId)
      .in('status', ['open', 'reopened'])
      .not('due_date', 'is', null),
    supabase
      .from('transmittals')
      .select('id, number, recipient, issued_date')
      .eq('project_id', projectId)
      .not('issued_date', 'is', null),
  ]);

  const items: CalendarItem[] = [];

  for (const t of (taskRes.data ?? []) as { id: string; title: string; status: string; planned_end_date: string | null; due_date: string | null }[]) {
    const date = t.due_date ?? t.planned_end_date;
    if (!date) continue;
    items.push({ id: `task-${t.id}`, date, kind: 'task', title: t.title, subtitle: null, deadline: true, done: t.status === 'done', taskId: t.id });
  }
  for (const a of (todoRes.data ?? []) as { id: string; title: string; status: string; due_date: string }[]) {
    items.push({ id: `todo-${a.id}`, date: a.due_date, kind: 'todo', title: a.title, subtitle: 'To-do', deadline: true, done: a.status === 'done', taskId: null });
  }
  for (const e of (eventRes.data ?? []) as { id: string; title: string; kind: string | null; location: string | null; starts_at: string }[]) {
    // starts_at is a timestamptz — bucket by the LOCAL day it falls on.
    items.push({ id: `event-${e.id}`, date: localDay(new Date(e.starts_at)), kind: 'event', title: e.title, subtitle: e.location || e.kind || null, deadline: false, done: false, taskId: null });
  }
  for (const r of (rfiRes.data ?? []) as { id: string; number: number; subject: string; due_date: string }[]) {
    items.push({ id: `rfi-${r.id}`, date: r.due_date, kind: 'rfi', title: `RFI #${r.number} due`, subtitle: r.subject, deadline: true, done: false, taskId: null });
  }
  for (const s of (snagRes.data ?? []) as { id: string; number: number; title: string; location: string | null; due_date: string }[]) {
    items.push({ id: `snag-${s.id}`, date: s.due_date, kind: 'snag', title: `Snag #${s.number} due`, subtitle: s.location || s.title, deadline: true, done: false, taskId: null });
  }
  for (const t of (trRes.data ?? []) as { id: string; number: number; recipient: string; issued_date: string }[]) {
    items.push({ id: `tr-${t.id}`, date: t.issued_date, kind: 'transmittal', title: `TR-${String(t.number).padStart(3, '0')} issued`, subtitle: `to ${t.recipient}`, deadline: false, done: false, taskId: null });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}
