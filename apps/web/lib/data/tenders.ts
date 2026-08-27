import { createClient } from '@/lib/supabase/server';
import { MEDIA_BUCKET } from '@/lib/data/quotes';

export type TenderStatus = 'invited' | 'submitted' | 'awarded' | 'not_selected' | 'withdrawn';

export interface TaskDoc {
  id: string;
  /** bid_contractor_id — null = the plan/awarded doc; a uuid = that bidder's doc. */
  contractorId: string | null;
  filename: string;
  kind: string;
  url: string | null;
}

/** BoQ / invoice PDFs visible to the viewer (RLS: plan doc to project viewers, a
 *  bid doc only to its owner or the PM), with short-lived signed URLs. */
export async function listTaskDocuments(taskId: string): Promise<TaskDoc[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_documents')
    .select('id, bid_contractor_id, filename, kind, path')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as { id: string; bid_contractor_id: string | null; filename: string; kind: string; path: string }[];
  if (rows.length === 0) return [];
  const { data: signed } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
  const urlByPath = new Map(((signed ?? []) as { path: string | null; signedUrl: string }[]).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    contractorId: r.bid_contractor_id,
    filename: r.filename,
    kind: r.kind,
    url: urlByPath.get(r.path) ?? null,
  }));
}

export interface TenderInvite {
  id: string;
  contractorId: string;
  contractorName: string;
  status: TenderStatus;
  submittedAt: string | null;
  /** This contractor's whole-task bid: one price + a works note (null until submitted). */
  bidPriceCents: number | null;
  worksNotes: string | null;
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
    .select('id, contractor_id, status, submitted_at, bid_price_cents, works_notes')
    .eq('task_id', taskId)
    .order('invited_at', { ascending: true });
  const invites = (rows ?? []) as {
    id: string;
    contractor_id: string;
    status: TenderStatus;
    submitted_at: string | null;
    bid_price_cents: number | null;
    works_notes: string | null;
  }[];
  if (invites.length === 0) return [];

  const ids = [...new Set(invites.map((i) => i.contractor_id))];
  const { data: profs } = await supabase.from('profiles').select('id, display_name, email').in('id', ids);
  const nameById = new Map(
    ((profs ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.display_name ?? p.email ?? 'Contractor',
    ]),
  );

  return invites.map((i) => ({
    id: i.id,
    contractorId: i.contractor_id,
    contractorName: nameById.get(i.contractor_id) ?? 'Contractor',
    status: i.status,
    submittedAt: i.submitted_at,
    bidPriceCents: i.bid_price_cents,
    worksNotes: i.works_notes,
  }));
}
