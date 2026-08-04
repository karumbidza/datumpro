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
