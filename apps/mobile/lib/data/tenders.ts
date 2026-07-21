import { supabase, currentUser } from '../supabase';

export type TenderStatus = 'invited' | 'submitted' | 'awarded' | 'not_selected' | 'withdrawn';

export interface MyTenderInvite {
  taskId: string;
  taskTitle: string;
  status: TenderStatus;
}

/** Tasks the current contractor is invited to tender (open invites only). They
 *  aren't project members, so these won't show in the normal task lists. */
export async function listMyTenderInvites(): Promise<MyTenderInvite[]> {
  const user = await currentUser();
  if (!user) return [];
  const { data } = await supabase
    .from('task_tender_invites')
    .select('status, task_id, tasks(title)')
    .eq('contractor_id', user.id)
    .in('status', ['invited', 'submitted'])
    .order('invited_at', { ascending: false });
  return ((data ?? []) as unknown as {
    status: TenderStatus;
    task_id: string;
    tasks: { title: string | null } | { title: string | null }[] | null;
  }[]).map((r) => {
    const tk = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
    return { taskId: r.task_id, taskTitle: tk?.title ?? 'Task', status: r.status };
  });
}

/** My invite status for one task, or null if I'm not an invitee. */
export async function myBidStatus(taskId: string): Promise<TenderStatus | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supabase
    .from('task_tender_invites')
    .select('status')
    .eq('task_id', taskId)
    .eq('contractor_id', user.id)
    .maybeSingle();
  return (data as { status: TenderStatus } | null)?.status ?? null;
}

/** Add a line to my sealed bid (bid_contractor_id set to me; RLS enforces it). */
export async function addBidStep(params: {
  taskId: string;
  orgId: string;
  title: string;
  costCents?: number;
  estQty?: number | null;
  estUnit?: 'hours' | 'days' | null;
  plannedStartDate?: string | null;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const { data: last } = await supabase
    .from('task_subtasks')
    .select('position')
    .eq('task_id', params.taskId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;
  const { error } = await supabase.from('task_subtasks').insert({
    org_id: params.orgId,
    task_id: params.taskId,
    title: params.title,
    cost_cents: Math.max(0, Math.round(params.costCents ?? 0)),
    est_qty: params.estQty ?? null,
    est_unit: params.estUnit ?? null,
    planned_start_date: params.plannedStartDate ?? null,
    bid_contractor_id: user.id,
    position,
  });
  if (error) throw new Error(error.message);
}

/** Seal my bid — the DB checks every line is priced/dated. */
export async function submitBid(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_tender_bid', { p_task_id: taskId });
  if (error) throw new Error(error.message);
}
