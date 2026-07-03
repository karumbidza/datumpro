import { createClient } from '@/lib/supabase/server';
import { parsePaymentTerms, type PaymentTerms } from '@datumpro/shared/domain';

export const MEDIA_BUCKET = 'project-media';

export type QuoteStatus = 'invited' | 'submitted' | 'declined' | 'awarded' | 'not_selected';

export interface QuoteRow {
  id: string;
  taskId: string;
  contractorId: string;
  contractorName: string | null;
  status: QuoteStatus;
  costCents: number | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  justification: string | null;
  paymentTerms: PaymentTerms;
  quoteUrl: string | null;
}

export interface TaskMediaRow {
  id: string;
  kind: string;
  purpose: string;
  caption: string | null;
  storagePath: string;
  url: string | null;
  uploaderName: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
}

/** Batch-resolve display names for a set of user ids in one query. */
async function nameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  return new Map(
    ((data ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.display_name || p.email || 'Member',
    ]),
  );
}

/** Batch-create signed URLs for private-bucket paths in a single request. */
async function signedUrlMap(paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(unique, 3600);
  const map = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
  }
  return map;
}

/** Quotes on a task the caller is allowed to see. RLS enforces cost
 *  confidentiality: staff & the project PM see every quote; a contractor sees
 *  only their own; everyone else sees none. */
export async function listTaskQuotes(taskId: string): Promise<QuoteRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_quotes')
    .select(
      'id, task_id, contractor_id, status, cost_cents, proposed_start, proposed_end, justification, payment_terms, quote_path, created_at',
    )
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });

  const rows = (data ?? []) as {
    id: string;
    task_id: string;
    contractor_id: string;
    status: QuoteStatus;
    cost_cents: number | null;
    proposed_start: string | null;
    proposed_end: string | null;
    justification: string | null;
    payment_terms: unknown;
    quote_path: string | null;
  }[];

  const names = await nameMap(rows.map((r) => r.contractor_id));
  const urls = await signedUrlMap(rows.map((r) => r.quote_path));

  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    contractorId: r.contractor_id,
    contractorName: names.get(r.contractor_id) ?? null,
    status: r.status,
    costCents: r.cost_cents,
    proposedStart: r.proposed_start,
    proposedEnd: r.proposed_end,
    justification: r.justification,
    paymentTerms: parsePaymentTerms(r.payment_terms),
    quoteUrl: r.quote_path ? urls.get(r.quote_path) ?? null : null,
  }));
}

/** Media attached to a task, with batched signed URLs and names. */
export async function listTaskMedia(taskId: string, purpose?: string): Promise<TaskMediaRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from('task_media')
    .select('id, kind, purpose, caption, storage_path, uploaded_by, gps_lat, gps_lng')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (purpose) query = query.eq('purpose', purpose);
  const { data } = await query;
  const rows = (data ?? []) as {
    id: string;
    kind: string;
    purpose: string;
    caption: string | null;
    storage_path: string;
    uploaded_by: string | null;
    gps_lat: number | null;
    gps_lng: number | null;
  }[];

  const names = await nameMap(rows.map((r) => r.uploaded_by));
  const urls = await signedUrlMap(rows.map((r) => r.storage_path));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    purpose: r.purpose,
    caption: r.caption,
    storagePath: r.storage_path,
    url: urls.get(r.storage_path) ?? null,
    uploaderName: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
    gpsLat: r.gps_lat,
    gpsLng: r.gps_lng,
  }));
}

/** Count of completion-purpose media — the gate for submitting a task. */
export async function completionMediaCount(taskId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('task_media')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId)
    .eq('purpose', 'completion');
  return count ?? 0;
}
