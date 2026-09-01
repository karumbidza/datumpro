import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type Urgency = 'low' | 'normal' | 'high' | 'urgent';

/** A lightweight to-do raised from the project chat — not a formal task. */
export interface ActionItem {
  id: string;
  projectId: string;
  title: string;
  detail: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  dueDate: string | null;
  urgency: Urgency;
  status: 'open' | 'done';
  doneAt: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  project_id: string;
  title: string;
  detail: string | null;
  assignee_id: string | null;
  created_by: string | null;
  due_date: string | null;
  urgency: Urgency;
  status: 'open' | 'done';
  done_at: string | null;
  created_at: string;
};

const SELECT = 'id, project_id, title, detail, assignee_id, created_by, due_date, urgency, status, done_at, created_at';

/** Sort weight for urgent-first ordering of open to-dos. */
const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

async function resolveNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
    map.set(p.id, p.display_name || p.email || 'Member');
  }
  return map;
}

function toItem(r: Row, names: Map<string, string>): ActionItem {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    detail: r.detail,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
    createdBy: r.created_by,
    createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
    dueDate: r.due_date,
    urgency: r.urgency ?? 'normal',
    status: r.status,
    doneAt: r.done_at,
    createdAt: r.created_at,
  };
}

/** Every action item on a project (RLS scopes to members). Open first, then by
 *  due date (undated last), newest within. */
export async function listProjectActionItems(projectId: string): Promise<ActionItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('action_items')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as Row[];
  const names = await resolveNames(supabase, rows.flatMap((r) => [r.assignee_id, r.created_by]));
  const items = rows.map((r) => toItem(r, names));
  const dueRank = (d: string | null) => (d ? d : '9999-12-31');
  return items.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    // Within open to-dos, most urgent first; then by due date. Done items just
    // fall to the bottom by due date.
    if (a.status === 'open') {
      const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (u !== 0) return u;
    }
    return dueRank(a.dueDate).localeCompare(dueRank(b.dueDate));
  });
}

/** Just what the calendar needs — dated action items on a project. */
export interface CalendarActionItem {
  id: string;
  title: string;
  status: 'open' | 'done';
  dueDate: string; // non-null (filtered)
  assigneeName: string | null;
}

export async function listCalendarActionItems(projectId: string): Promise<CalendarActionItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('action_items')
    .select('id, title, status, due_date, assignee_id')
    .eq('project_id', projectId)
    .not('due_date', 'is', null);
  const rows = (data ?? []) as {
    id: string;
    title: string;
    status: 'open' | 'done';
    due_date: string;
    assignee_id: string | null;
  }[];
  const names = await resolveNames(supabase, rows.map((r) => r.assignee_id));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    dueDate: r.due_date,
    assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
  }));
}
