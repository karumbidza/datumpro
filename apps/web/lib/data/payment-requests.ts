import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { PaymentRequestStatus } from '@datumpro/shared/domain';

const MEDIA_BUCKET = 'project-media';

export type PaymentRequestRow = {
  id: string;
  orgId: string;
  projectId: string;
  projectName: string;
  taskId: string | null;
  scheduleId: string | null;
  contractorId: string;
  contractorName: string | null;
  title: string;
  amountCents: number;
  status: PaymentRequestStatus;
  note: string | null;
  reviewNote: string | null;
  invoiceUrl: string | null;
  invoiceName: string | null;
  popUrl: string | null;
  popName: string | null;
  paidAt: string | null;
  paidReference: string | null;
  createdAt: string;
};

export type PaymentRequestSummary = {
  requestedCents: number;
  approvedCents: number;
  paidCents: number;
};

/** Batch-sign private-bucket paths in one request (invoice + POP docs). */
async function signedUrlMap(paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(unique, 3600);
  const map = new Map<string, string>();
  for (const item of data ?? []) if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
  return map;
}

type RawRow = {
  id: string;
  org_id: string;
  project_id: string;
  task_id: string | null;
  schedule_id: string | null;
  contractor_id: string;
  title: string;
  amount_cents: number;
  status: PaymentRequestStatus;
  note: string | null;
  review_note: string | null;
  invoice_path: string | null;
  invoice_name: string | null;
  pop_path: string | null;
  pop_name: string | null;
  paid_at: string | null;
  paid_reference: string | null;
  created_at: string;
  projects: { name: string } | { name: string }[] | null;
};

async function hydrate(rows: RawRow[], names: Map<string, string>): Promise<PaymentRequestRow[]> {
  const urls = await signedUrlMap(rows.flatMap((r) => [r.invoice_path, r.pop_path]));
  return rows.map((r) => {
    const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return {
      id: r.id,
      orgId: r.org_id,
      projectId: r.project_id,
      projectName: proj?.name ?? 'Project',
      taskId: r.task_id,
      scheduleId: r.schedule_id,
      contractorId: r.contractor_id,
      contractorName: names.get(r.contractor_id) ?? null,
      title: r.title,
      amountCents: r.amount_cents,
      status: r.status,
      note: r.note,
      reviewNote: r.review_note,
      invoiceUrl: r.invoice_path ? urls.get(r.invoice_path) ?? null : null,
      invoiceName: r.invoice_name,
      popUrl: r.pop_path ? urls.get(r.pop_path) ?? null : null,
      popName: r.pop_name,
      paidAt: r.paid_at,
      paidReference: r.paid_reference,
      createdAt: r.created_at,
    };
  });
}

const SELECT =
  'id, org_id, project_id, task_id, schedule_id, contractor_id, title, amount_cents, status, note, review_note, invoice_path, invoice_name, pop_path, pop_name, paid_at, paid_reference, created_at, projects(name)';

/** The signed-in contractor's own requests (RLS also scopes to them). */
export async function listMyPaymentRequests(
  userId: string,
): Promise<{ rows: PaymentRequestRow[]; summary: PaymentRequestSummary }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('contractor_payment_requests')
    .select(SELECT)
    .eq('contractor_id', userId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as RawRow[];
  const hydrated = await hydrate(rows, new Map());
  const summary: PaymentRequestSummary = { requestedCents: 0, approvedCents: 0, paidCents: 0 };
  for (const r of hydrated) {
    if (r.status === 'requested') summary.requestedCents += r.amountCents;
    else if (r.status === 'approved') summary.approvedCents += r.amountCents;
    else if (r.status === 'paid') summary.paidCents += r.amountCents;
  }
  return { rows: hydrated, summary };
}

/** All requests for a project — for the manager's Finance view (RLS scopes to
 *  staff / the project PM / owning contractors). Pending first. */
export async function listProjectPaymentRequests(projectId: string): Promise<PaymentRequestRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('contractor_payment_requests')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as RawRow[];

  // Resolve contractor display names.
  const ids = [...new Set(rows.map((r) => r.contractor_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', ids);
    for (const p of profs ?? []) names.set(p.id, p.display_name || p.email || 'Contractor');
  }
  const hydrated = await hydrate(rows, names);
  const order: Record<PaymentRequestStatus, number> = { requested: 0, approved: 1, paid: 2, rejected: 3 };
  return hydrated.sort((a, b) => order[a.status] - order[b.status]);
}

/** Projects the user may raise a request against (their project memberships),
 *  with the org id needed to build the upload path. */
export async function listMyRequestProjects(
  userId: string,
): Promise<{ id: string; name: string; orgId: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('project_members')
    .select('project_id, projects(id, name, org_id)')
    .eq('user_id', userId);
  const seen = new Map<string, { id: string; name: string; orgId: string }>();
  for (const row of data ?? []) {
    const p = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    if (p && !seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.name, orgId: p.org_id });
  }
  return [...seen.values()];
}
