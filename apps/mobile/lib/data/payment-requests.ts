import { decode } from 'base64-arraybuffer';
import { supabase, currentUser} from '../supabase';
import type { PaymentRequestStatus } from '@datumpro/shared/domain';

const BUCKET = 'project-media';

export type MyPaymentRequest = {
  id: string;
  projectName: string;
  title: string;
  amountCents: number;
  status: PaymentRequestStatus;
  reviewNote: string | null;
  invoiceUrl: string | null;
  popUrl: string | null;
  paidReference: string | null;
  createdAt: string;
};

export type RequestProject = { id: string; name: string; orgId: string };

/** The signed-in contractor's payment requests (RLS scopes to them), with
 *  short-lived signed URLs for the invoice + POP docs. */
export async function listMyPaymentRequests(): Promise<MyPaymentRequest[]> {
  const { data } = await supabase
    .from('contractor_payment_requests')
    .select(
      'id, project_id, title, amount_cents, status, review_note, invoice_path, pop_path, paid_reference, created_at, projects(name)',
    )
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as {
    id: string;
    title: string;
    amount_cents: number;
    status: PaymentRequestStatus;
    review_note: string | null;
    invoice_path: string | null;
    pop_path: string | null;
    paid_reference: string | null;
    created_at: string;
    projects: { name: string } | { name: string }[] | null;
  }[];
  if (rows.length === 0) return [];

  const paths = [...new Set(rows.flatMap((r) => [r.invoice_path, r.pop_path]).filter(Boolean))] as string[];
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
    for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    }
  }
  return rows.map((r) => {
    const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return {
      id: r.id,
      projectName: proj?.name ?? 'Project',
      title: r.title,
      amountCents: r.amount_cents,
      status: r.status,
      reviewNote: r.review_note,
      invoiceUrl: r.invoice_path ? urlByPath.get(r.invoice_path) ?? null : null,
      popUrl: r.pop_path ? urlByPath.get(r.pop_path) ?? null : null,
      paidReference: r.paid_reference,
      createdAt: r.created_at,
    };
  });
}

/** Projects the contractor can raise a request against (their memberships). */
export async function listMyRequestProjects(): Promise<RequestProject[]> {
  const user = await currentUser();
  if (!user) return [];
  const { data } = await supabase
    .from('project_members')
    .select('project_id, projects(id, name, org_id)')
    .eq('user_id', user.id);
  const seen = new Map<string, RequestProject>();
  for (const row of (data ?? []) as { projects: { id: string; name: string; org_id: string } | { id: string; name: string; org_id: string }[] | null }[]) {
    const p = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    if (p && !seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.name, orgId: p.org_id });
  }
  return [...seen.values()];
}

/** Upload an invoice photo/doc to the private bucket; returns its path + name. */
export async function uploadPaymentDoc(params: {
  orgId: string;
  projectId: string;
  base64: string;
  ext: string;
  mime: string;
}): Promise<{ path: string; name: string }> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const path = `${params.orgId}/${params.projectId}/payment-requests/${unique}.${params.ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(params.base64), { contentType: params.mime, upsert: false });
  if (error) throw error;
  return { path, name: `invoice.${params.ext}` };
}

/** The assignee raises a payment request against an approved task, with a
 *  mandatory invoice. The DB (enforce_payment_request_insert) validates the
 *  assignee, approved plan, amount cap and invoice — org/project come from the
 *  owed task the caller picked. */
export async function requestPayment(input: {
  taskId: string;
  orgId: string;
  projectId: string;
  title: string;
  amountCents: number;
  note?: string | null;
  invoicePath: string;
  invoiceName: string;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('contractor_payment_requests').insert({
    org_id: input.orgId,
    project_id: input.projectId,
    task_id: input.taskId,
    contractor_id: user.id,
    title: input.title,
    amount_cents: input.amountCents,
    note: input.note ?? null,
    invoice_path: input.invoicePath,
    invoice_name: input.invoiceName,
    status: 'requested',
  });
  if (error) throw error;
}
