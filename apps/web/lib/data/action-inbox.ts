import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** A single thing awaiting the current user, rolled up from across the registers. */
export type InboxKind = 'rfi_answer' | 'rfi_close' | 'snag_fix' | 'snag_verify' | 'action_item';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string; // the action, e.g. "RFI #12 to answer"
  subtitle: string | null; // detail · project
  href: string;
  dueDate: string | null; // YYYY-MM-DD
}

export interface ActionInbox {
  items: InboxItem[]; // sorted: overdue first, then by due date
  total: number;
}

type RfiRow = {
  id: string;
  number: number;
  subject: string;
  project_id: string;
  due_date: string | null;
  assignee_id: string | null;
  raised_by: string | null;
  status: string;
};
type SnagRow = {
  id: string;
  number: number;
  title: string;
  location: string | null;
  project_id: string;
  due_date: string | null;
  assignee_id: string | null;
  raised_by: string | null;
  status: string;
};
type ActionItemRow = { id: string; title: string; project_id: string; due_date: string | null };

/** Everything awaiting this user across the registers — RFIs to answer or close,
 *  snags to fix or verify, and their open to-dos. RLS scopes every read; this
 *  additionally filters to the active org and the user's own involvement. */
export async function listMyActionInbox(orgId: string, userId: string): Promise<ActionInbox> {
  const supabase = await createClient();

  const [rfiRes, snagRes, aiRes] = await Promise.all([
    supabase
      .from('rfis')
      .select('id, number, subject, project_id, due_date, assignee_id, raised_by, status')
      .eq('org_id', orgId)
      .or(`assignee_id.eq.${userId},raised_by.eq.${userId}`),
    supabase
      .from('snags')
      .select('id, number, title, location, project_id, due_date, assignee_id, raised_by, status')
      .eq('org_id', orgId)
      .or(`assignee_id.eq.${userId},raised_by.eq.${userId}`),
    supabase
      .from('action_items')
      .select('id, title, project_id, due_date')
      .eq('org_id', orgId)
      .eq('assignee_id', userId)
      .eq('status', 'open'),
  ]);

  const rfis = (rfiRes.data ?? []) as RfiRow[];
  const snags = (snagRes.data ?? []) as SnagRow[];
  const actionItems = (aiRes.data ?? []) as ActionItemRow[];

  const projectIds = [
    ...new Set([...rfis, ...snags, ...actionItems].map((r) => r.project_id)),
  ];
  const projectName = new Map<string, string>();
  if (projectIds.length) {
    const { data } = await supabase.from('projects').select('id, name').in('id', projectIds);
    for (const p of (data ?? []) as { id: string; name: string }[]) projectName.set(p.id, p.name);
  }
  const withProject = (projectId: string, detail: string | null): string | null => {
    const pn = projectName.get(projectId);
    return [detail, pn].filter(Boolean).join(' · ') || null;
  };

  const items: InboxItem[] = [];

  for (const r of rfis) {
    const base = `/projects/${r.project_id}/rfis`;
    if (r.assignee_id === userId && (r.status === 'open' || r.status === 'reopened')) {
      items.push({ id: `rfi-a-${r.id}`, kind: 'rfi_answer', title: `RFI #${r.number} to answer`, subtitle: withProject(r.project_id, r.subject), href: base, dueDate: r.due_date });
    } else if (r.raised_by === userId && r.status === 'answered') {
      items.push({ id: `rfi-c-${r.id}`, kind: 'rfi_close', title: `RFI #${r.number} answered — review`, subtitle: withProject(r.project_id, r.subject), href: base, dueDate: r.due_date });
    }
  }

  for (const s of snags) {
    const base = `/projects/${s.project_id}/snags`;
    const detail = s.location || s.title;
    if (s.assignee_id === userId && (s.status === 'open' || s.status === 'reopened')) {
      items.push({ id: `snag-f-${s.id}`, kind: 'snag_fix', title: `Snag #${s.number} to fix`, subtitle: withProject(s.project_id, detail), href: base, dueDate: s.due_date });
    } else if (s.raised_by === userId && s.status === 'fixed') {
      items.push({ id: `snag-v-${s.id}`, kind: 'snag_verify', title: `Snag #${s.number} fixed — verify`, subtitle: withProject(s.project_id, detail), href: base, dueDate: s.due_date });
    }
  }

  for (const a of actionItems) {
    items.push({ id: `ai-${a.id}`, kind: 'action_item', title: a.title, subtitle: withProject(a.project_id, 'To-do'), href: `/projects/${a.project_id}/chat`, dueDate: a.due_date });
  }

  // Overdue first, then by due date, undated last.
  const today = new Date().toISOString().slice(0, 10);
  const rank = (d: string | null) => (d == null ? 2 : d < today ? 0 : 1);
  items.sort((x, y) => rank(x.dueDate) - rank(y.dueDate) || (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999'));

  return { items, total: items.length };
}
