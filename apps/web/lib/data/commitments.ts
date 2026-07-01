import { createClient } from '@/lib/supabase/server';
import { parsePaymentTerms, type CommitmentStatus, type PaymentTerms } from '@datumpro/shared/domain';

export const MEDIA_BUCKET = 'project-media';

export interface CommitmentRow {
  id: string;
  taskId: string;
  contractorId: string | null;
  contractorName: string | null;
  status: CommitmentStatus;
  costCents: number | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  justification: string | null;
  paymentTerms: PaymentTerms;
  quotePath: string | null;
  quoteUrl: string | null;
  agreedCostCents: number | null;
}

export interface TaskMediaRow {
  id: string;
  kind: string;
  purpose: string;
  caption: string | null;
  storagePath: string;
  url: string | null;
  uploaderName: string | null;
}

async function displayName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', userId)
    .maybeSingle();
  const p = data as { display_name: string | null; email: string | null } | null;
  return p?.display_name || p?.email || 'Member';
}

/** The single commitment for a task (contractor negotiation), if one exists. */
export async function getTaskCommitment(taskId: string): Promise<CommitmentRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_commitments')
    .select(
      'id, task_id, contractor_id, status, cost_cents, proposed_start, proposed_end, justification, payment_terms, quote_path, agreed_cost_cents',
    )
    .eq('task_id', taskId)
    .maybeSingle();
  if (!data) return null;
  const r = data as {
    id: string;
    task_id: string;
    contractor_id: string | null;
    status: CommitmentStatus;
    cost_cents: number | null;
    proposed_start: string | null;
    proposed_end: string | null;
    justification: string | null;
    payment_terms: unknown;
    quote_path: string | null;
    agreed_cost_cents: number | null;
  };

  let quoteUrl: string | null = null;
  if (r.quote_path) {
    const { data: signed } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(r.quote_path, 3600);
    quoteUrl = signed?.signedUrl ?? null;
  }

  return {
    id: r.id,
    taskId: r.task_id,
    contractorId: r.contractor_id,
    contractorName: await displayName(r.contractor_id),
    status: r.status,
    costCents: r.cost_cents,
    proposedStart: r.proposed_start,
    proposedEnd: r.proposed_end,
    justification: r.justification,
    paymentTerms: parsePaymentTerms(r.payment_terms),
    quotePath: r.quote_path,
    quoteUrl,
    agreedCostCents: r.agreed_cost_cents,
  };
}

/** Media attached to a task, with short-lived signed URLs for the private bucket. */
export async function listTaskMedia(taskId: string, purpose?: string): Promise<TaskMediaRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from('task_media')
    .select('id, kind, purpose, caption, storage_path, uploaded_by')
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
  }[];

  const names = new Map<string, string | null>();
  for (const id of [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))] as string[]) {
    names.set(id, await displayName(id));
  }

  const out: TaskMediaRow[] = [];
  for (const r of rows) {
    const { data: signed } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(r.storage_path, 3600);
    out.push({
      id: r.id,
      kind: r.kind,
      purpose: r.purpose,
      caption: r.caption,
      storagePath: r.storage_path,
      url: signed?.signedUrl ?? null,
      uploaderName: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
    });
  }
  return out;
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
