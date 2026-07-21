import { createClient } from '@/lib/supabase/server';

export type TenderStatus = 'invited' | 'submitted' | 'awarded' | 'not_selected' | 'withdrawn';

export interface TenderInvite {
  id: string;
  contractorId: string;
  contractorName: string;
  status: TenderStatus;
  submittedAt: string | null;
  /** Summary of this contractor's bid (their competing plan). */
  bidLineCount: number;
  bidTotalCents: number;
}

export interface BidLine {
  id: string;
  contractorId: string;
  title: string;
  costCents: number;
  estQty: number | null;
  estUnit: 'hours' | 'days' | null;
  plannedStartDate: string | null;
}

/** Task ids in a project that are currently out to tender (open invites). */
export async function tenderingTaskIds(projectId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_tender_invites')
    .select('task_id')
    .eq('project_id', projectId)
    .in('status', ['invited', 'submitted']);
  return new Set(((data ?? []) as { task_id: string }[]).map((r) => r.task_id));
}

/** Is this task out to tender? True while any invite is still open. */
export async function taskIsTendering(taskId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('task_tender_invites')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId)
    .in('status', ['invited', 'submitted']);
  return (count ?? 0) > 0;
}

/** The tender invites for a task with each bidder's name + bid summary. PM/staff
 *  see all; a contractor sees only their own row (RLS). */
export async function listTenderInvites(taskId: string): Promise<TenderInvite[]> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('task_tender_invites')
    .select('id, contractor_id, status, submitted_at')
    .eq('task_id', taskId)
    .order('invited_at', { ascending: true });
  const invites = (rows ?? []) as { id: string; contractor_id: string; status: TenderStatus; submitted_at: string | null }[];
  if (invites.length === 0) return [];

  const ids = [...new Set(invites.map((i) => i.contractor_id))];
  const [{ data: profs }, { data: lines }] = await Promise.all([
    supabase.from('profiles').select('id, display_name, email').in('id', ids),
    supabase.from('task_subtasks').select('bid_contractor_id, cost_cents').eq('task_id', taskId).not('bid_contractor_id', 'is', null),
  ]);
  const nameById = new Map(
    ((profs ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.display_name ?? p.email ?? 'Contractor',
    ]),
  );
  const summary = new Map<string, { count: number; total: number }>();
  for (const l of (lines ?? []) as { bid_contractor_id: string; cost_cents: number | null }[]) {
    const e = summary.get(l.bid_contractor_id) ?? { count: 0, total: 0 };
    e.count += 1;
    e.total += l.cost_cents ?? 0;
    summary.set(l.bid_contractor_id, e);
  }

  return invites.map((i) => ({
    id: i.id,
    contractorId: i.contractor_id,
    contractorName: nameById.get(i.contractor_id) ?? 'Contractor',
    status: i.status,
    submittedAt: i.submitted_at,
    bidLineCount: summary.get(i.contractor_id)?.count ?? 0,
    bidTotalCents: summary.get(i.contractor_id)?.total ?? 0,
  }));
}

/** Every bid line for a task, keyed by contractor — the PM's comparison view.
 *  RLS returns only bids the viewer may see (all, for the PM). */
export async function listBidLinesByContractor(taskId: string): Promise<Map<string, BidLine[]>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_subtasks')
    .select('id, bid_contractor_id, title, cost_cents, est_qty, est_unit, planned_start_date, position')
    .eq('task_id', taskId)
    .not('bid_contractor_id', 'is', null)
    .order('position', { ascending: true });
  const map = new Map<string, BidLine[]>();
  for (const r of (data ?? []) as {
    id: string;
    bid_contractor_id: string;
    title: string;
    cost_cents: number | null;
    est_qty: number | null;
    est_unit: 'hours' | 'days' | null;
    planned_start_date: string | null;
  }[]) {
    const line: BidLine = {
      id: r.id,
      contractorId: r.bid_contractor_id,
      title: r.title,
      costCents: r.cost_cents ?? 0,
      estQty: r.est_qty,
      estUnit: r.est_unit,
      plannedStartDate: r.planned_start_date,
    };
    const arr = map.get(r.bid_contractor_id) ?? [];
    arr.push(line);
    map.set(r.bid_contractor_id, arr);
  }
  return map;
}
