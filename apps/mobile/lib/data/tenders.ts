import { decode } from 'base64-arraybuffer';
import { supabase, currentUser } from '../supabase';

const BUCKET = 'project-media';

export type TenderStatus = 'invited' | 'submitted' | 'awarded' | 'not_selected' | 'withdrawn';

export interface TaskDoc {
  id: string;
  contractorId: string | null;
  filename: string;
  url: string | null;
}

/** BoQ / invoice PDFs the viewer may see for a task (RLS-scoped), with signed URLs. */
export async function listTaskDocuments(taskId: string): Promise<TaskDoc[]> {
  const { data } = await supabase
    .from('task_documents')
    .select('id, bid_contractor_id, filename, path')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as { id: string; bid_contractor_id: string | null; filename: string; path: string }[];
  if (rows.length === 0) return [];
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
  const urlByPath = new Map(((signed ?? []) as { path: string | null; signedUrl: string }[]).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({ id: r.id, contractorId: r.bid_contractor_id, filename: r.filename, url: urlByPath.get(r.path) ?? null }));
}

/** Upload a BoQ/invoice PDF and record it against a plan (bid=false) or the
 *  uploader's sealed bid (bid=true). */
export async function uploadTaskDocument(params: {
  taskId: string;
  orgId: string;
  projectId: string;
  base64: string;
  filename: string;
  mime: string;
  bid: boolean;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const path = `${params.orgId}/${params.projectId}/tasks/${params.taskId}/docs/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, decode(params.base64), {
    contentType: params.mime || 'application/pdf',
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);
  const { error } = await supabase.from('task_documents').insert({
    org_id: params.orgId,
    project_id: params.projectId,
    task_id: params.taskId,
    uploaded_by: user.id,
    bid_contractor_id: params.bid ? user.id : null,
    kind: /invoice/i.test(params.filename) ? 'invoice' : 'boq',
    filename: params.filename.slice(0, 200),
    path,
  });
  if (error) throw new Error(error.message);
}

export async function removeTaskDocument(id: string): Promise<void> {
  const { data: doc } = await supabase.from('task_documents').select('path').eq('id', id).maybeSingle();
  const { error } = await supabase.from('task_documents').delete().eq('id', id);
  if (error) throw new Error(error.message);
  const path = (doc as { path: string } | null)?.path;
  if (path) await supabase.storage.from(BUCKET).remove([path]); // drop the object too
}

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
