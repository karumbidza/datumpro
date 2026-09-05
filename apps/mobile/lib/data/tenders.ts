import { decode } from 'base64-arraybuffer';
import { supabase, currentUser } from '../supabase';
import { assertUploadSize, MAX_PROJECT_MEDIA_BYTES } from '../upload-limits';

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
  assertUploadSize(params.base64, MAX_PROJECT_MEDIA_BYTES, 'This document');
  const ext = (params.filename.includes('.') ? params.filename.split('.').pop() : 'bin')!.toLowerCase().slice(0, 8);
  const path = `${params.orgId}/${params.projectId}/tasks/${params.taskId}/docs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, decode(params.base64), {
    contentType: params.mime || 'application/octet-stream',
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

/** My sealed bid on one task: the invite status plus the price + works notes I've
 *  already entered (null when not yet submitted). `status` is null if I'm not an
 *  invitee. */
export interface MyBid {
  status: TenderStatus;
  bidPriceCents: number | null;
  worksNotes: string | null;
}

/** My bid for one task, or null if I'm not an invitee. Reads back the whole-task
 *  price + notes so the form can prefill an already-submitted bid. */
export async function myBid(taskId: string): Promise<MyBid | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supabase
    .from('task_tender_invites')
    .select('status, bid_price_cents, works_notes')
    .eq('task_id', taskId)
    .eq('contractor_id', user.id)
    .maybeSingle();
  const row = data as { status: TenderStatus; bid_price_cents: number | null; works_notes: string | null } | null;
  if (!row) return null;
  return { status: row.status, bidPriceCents: row.bid_price_cents, worksNotes: row.works_notes };
}

/** Submit (or update) my whole-task sealed bid: one price + a works note. The RPC
 *  writes both onto my invite row and raises if the price is null/negative or the
 *  notes are blank. Editable until the PM decides. */
export async function submitBid(taskId: string, priceCents: number, worksNotes: string): Promise<void> {
  const { error } = await supabase.rpc('submit_tender_bid', {
    p_task_id: taskId,
    p_price_cents: priceCents,
    p_works_notes: worksNotes,
  });
  if (error) throw new Error(error.message);
}
