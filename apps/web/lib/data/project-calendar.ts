import { createClient } from '@/lib/supabase/server';
import type { TaskStatus, TaskSlaStatus, TaskPriority } from '@datumpro/shared/domain';

/** A task with the fields the calendar view renders — schedule window, priority
 *  accent and assignee name. */
export interface CalendarTask {
  id: string;
  title: string;
  status: TaskStatus;
  sla_status: TaskSlaStatus;
  priority: TaskPriority;
  assigneeName: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  due_date: string | null;
}

export async function listCalendarTasks(projectId: string): Promise<CalendarTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(
      'id, title, status, sla_status, priority, assignee_id, planned_start_date, planned_end_date, due_date',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as {
    id: string;
    title: string;
    status: TaskStatus;
    sla_status: TaskSlaStatus;
    priority: TaskPriority;
    assignee_id: string | null;
    planned_start_date: string | null;
    planned_end_date: string | null;
    due_date: string | null;
  }[];

  const assigneeIds = [...new Set(rows.map((r) => r.assignee_id).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', assigneeIds);
    names = new Map(
      ((profiles ?? []) as { id: string; display_name: string | null; email: string | null }[]).map(
        (p) => [p.id, p.display_name || p.email || 'Member'],
      ),
    );
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    sla_status: r.sla_status,
    priority: r.priority,
    assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
    planned_start_date: r.planned_start_date,
    planned_end_date: r.planned_end_date,
    due_date: r.due_date,
  }));
}

/** A dated item from one of the project registers, surfaced on the calendar. RFI
 *  and snag due dates are deadlines (overdue-able); a transmittal is a record of
 *  what was issued that day. */
export type CalendarMarkerKind = 'rfi_due' | 'snag_due' | 'transmittal';

export interface CalendarMarker {
  id: string;
  kind: CalendarMarkerKind;
  date: string; // YYYY-MM-DD
  title: string; // e.g. "RFI #12 due", "TR-007 issued"
  subtitle: string | null;
  isDeadline: boolean; // rfi/snag due dates
  href: string; // the register page
}

/** Register items to plot on the calendar: open RFI & snag response/due dates
 *  (deadlines) and transmittal issue dates (records). RLS scopes every read. */
export async function listCalendarMarkers(projectId: string): Promise<CalendarMarker[]> {
  const supabase = await createClient();
  const base = `/projects/${projectId}`;

  const [rfiRes, snagRes, trRes] = await Promise.all([
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

  const markers: CalendarMarker[] = [];

  for (const r of (rfiRes.data ?? []) as { id: string; number: number; subject: string; due_date: string }[]) {
    markers.push({
      id: `rfi-${r.id}`,
      kind: 'rfi_due',
      date: r.due_date,
      title: `RFI #${r.number} due`,
      subtitle: r.subject,
      isDeadline: true,
      href: `${base}/rfis`,
    });
  }
  for (const s of (snagRes.data ?? []) as {
    id: string;
    number: number;
    title: string;
    location: string | null;
    due_date: string;
  }[]) {
    markers.push({
      id: `snag-${s.id}`,
      kind: 'snag_due',
      date: s.due_date,
      title: `Snag #${s.number} due`,
      subtitle: s.location || s.title,
      isDeadline: true,
      href: `${base}/snags`,
    });
  }
  for (const t of (trRes.data ?? []) as { id: string; number: number; recipient: string; issued_date: string }[]) {
    markers.push({
      id: `tr-${t.id}`,
      kind: 'transmittal',
      date: t.issued_date,
      title: `TR-${String(t.number).padStart(3, '0')} issued`,
      subtitle: `to ${t.recipient}`,
      isDeadline: false,
      href: `${base}/transmittals`,
    });
  }

  return markers;
}
