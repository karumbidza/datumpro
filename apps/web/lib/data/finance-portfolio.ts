import { createClient } from '@/lib/supabase/server';

/** One project's money position, in integer cents. */
export interface ProjectFinanceRow {
  projectId: string;
  name: string;
  status: string;
  budgetCents: number;
  invoicedCents: number;
  paidCents: number;
  outstandingCents: number;
  /** Contractor cost paid out so far (money out) — draws with status 'paid'. */
  costToDateCents: number;
}

export interface OrgFinanceOverview {
  totals: {
    budgetCents: number;
    invoicedCents: number;
    paidCents: number;
    outstandingCents: number;
    costToDateCents: number;
  };
  /** Collection rate = paid / invoiced (0–1); null when nothing is invoiced. */
  collectionRate: number | null;
  projects: ProjectFinanceRow[];
}

export interface AgingBucket {
  key: string;
  label: string;
  cents: number;
  count: number;
  overdue: boolean;
}

export interface ReceivablesAging {
  totalOutstandingCents: number;
  overdueCents: number;
  buckets: AgingBucket[];
}

/** Aged receivables across the org: unpaid client-invoice balances bucketed by
 *  how far past their due date they are. Outstanding = invoice total − confirmed
 *  payments; void invoices are excluded. `asOf` is passed in (server "today") so
 *  the function stays deterministic. */
export async function orgReceivablesAging(orgId: string, asOf: Date): Promise<ReceivablesAging> {
  const supabase = await createClient();
  const [invoicesRes, paymentsRes] = await Promise.all([
    supabase.from('invoices').select('id, status, total_cents, due_date').eq('org_id', orgId),
    supabase.from('payments').select('invoice_id, amount_cents, status').eq('org_id', orgId),
  ]);

  const invoices = (invoicesRes.data ?? []) as {
    id: string;
    status: string;
    total_cents: number;
    due_date: string | null;
  }[];
  const paidByInvoice = new Map<string, number>();
  for (const p of (paymentsRes.data ?? []) as { invoice_id: string; amount_cents: number; status: string }[]) {
    if (p.status !== 'confirmed') continue;
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + (p.amount_cents ?? 0));
  }

  const defs: { key: string; label: string; overdue: boolean; test: (days: number, due: boolean) => boolean }[] = [
    { key: 'current', label: 'Not yet due', overdue: false, test: (d, due) => !due || d <= 0 },
    { key: '1_30', label: '1–30 days', overdue: true, test: (d, due) => due && d >= 1 && d <= 30 },
    { key: '31_60', label: '31–60 days', overdue: true, test: (d, due) => due && d >= 31 && d <= 60 },
    { key: '61_90', label: '61–90 days', overdue: true, test: (d, due) => due && d >= 61 && d <= 90 },
    { key: '90_plus', label: '90+ days', overdue: true, test: (d, due) => due && d > 90 },
  ];
  const buckets: AgingBucket[] = defs.map((d) => ({ key: d.key, label: d.label, cents: 0, count: 0, overdue: d.overdue }));
  const asOfMs = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  let totalOutstandingCents = 0;
  let overdueCents = 0;

  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    const outstanding = inv.total_cents - (paidByInvoice.get(inv.id) ?? 0);
    if (outstanding <= 0) continue;
    totalOutstandingCents += outstanding;

    const hasDue = !!inv.due_date;
    let days = 0;
    if (hasDue) {
      const due = new Date(inv.due_date as string);
      const dueMs = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
      days = Math.round((asOfMs - dueMs) / 86_400_000);
    }
    const def = defs.find((d) => d.test(days, hasDue));
    if (!def) continue; // unreachable — the buckets are exhaustive
    const bucket = buckets.find((b) => b.key === def.key);
    if (bucket) {
      bucket.cents += outstanding;
      bucket.count += 1;
    }
    if (def.overdue) overdueCents += outstanding;
  }

  return { totalOutstandingCents, overdueCents, buckets };
}

/** Portfolio-wide money view for a single org. Four org-scoped queries — no
 *  per-project fan-out. RLS still applies, so a caller only ever aggregates
 *  rows they're allowed to read; the hub is gated to owner/admin/finance who
 *  can see the whole org. Paid is attributed to a project via invoice → project
 *  (payments carry invoice_id, not project_id) and counts only confirmed money. */
export async function orgFinanceOverview(orgId: string): Promise<OrgFinanceOverview> {
  const supabase = await createClient();

  const [projectsRes, budgetRes, invoicesRes, paymentsRes, drawsRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase.from('budget_lines').select('project_id, budget_amount_cents').eq('org_id', orgId),
    supabase.from('invoices').select('id, project_id, status, total_cents').eq('org_id', orgId),
    supabase.from('payments').select('invoice_id, amount_cents, status').eq('org_id', orgId),
    supabase.from('payment_schedule').select('project_id, amount_cents, status').eq('org_id', orgId),
  ]);

  const projects = (projectsRes.data ?? []) as { id: string; name: string; status: string }[];
  const budgetLines = (budgetRes.data ?? []) as { project_id: string; budget_amount_cents: number }[];
  const invoices = (invoicesRes.data ?? []) as {
    id: string;
    project_id: string;
    status: string;
    total_cents: number;
  }[];
  const payments = (paymentsRes.data ?? []) as {
    invoice_id: string;
    amount_cents: number;
    status: string;
  }[];
  const draws = (drawsRes.data ?? []) as {
    project_id: string;
    amount_cents: number;
    status: string;
  }[];

  // Seed a row per project so the whole portfolio shows, including £0 projects.
  const rows = new Map<string, ProjectFinanceRow>();
  for (const p of projects) {
    rows.set(p.id, {
      projectId: p.id,
      name: p.name,
      status: p.status,
      budgetCents: 0,
      invoicedCents: 0,
      paidCents: 0,
      outstandingCents: 0,
      costToDateCents: 0,
    });
  }

  for (const b of budgetLines) {
    const row = rows.get(b.project_id);
    if (row) row.budgetCents += b.budget_amount_cents ?? 0;
  }

  // invoice_id → project_id, so confirmed payments can be attributed downstream.
  const invoiceProject = new Map<string, string>();
  for (const inv of invoices) {
    invoiceProject.set(inv.id, inv.project_id);
    if (inv.status === 'void') continue;
    const row = rows.get(inv.project_id);
    if (row) row.invoicedCents += inv.total_cents ?? 0;
  }

  for (const pay of payments) {
    if (pay.status !== 'confirmed') continue;
    const projectId = invoiceProject.get(pay.invoice_id);
    const row = projectId ? rows.get(projectId) : undefined;
    if (row) row.paidCents += pay.amount_cents ?? 0;
  }

  for (const draw of draws) {
    if (draw.status !== 'paid') continue;
    const row = rows.get(draw.project_id);
    if (row) row.costToDateCents += draw.amount_cents ?? 0;
  }

  const projectRows = [...rows.values()];
  for (const row of projectRows) {
    row.outstandingCents = row.invoicedCents - row.paidCents;
  }

  const totals = projectRows.reduce(
    (acc, r) => {
      acc.budgetCents += r.budgetCents;
      acc.invoicedCents += r.invoicedCents;
      acc.paidCents += r.paidCents;
      acc.outstandingCents += r.outstandingCents;
      acc.costToDateCents += r.costToDateCents;
      return acc;
    },
    { budgetCents: 0, invoicedCents: 0, paidCents: 0, outstandingCents: 0, costToDateCents: 0 },
  );

  return {
    totals,
    collectionRate: totals.invoicedCents > 0 ? totals.paidCents / totals.invoicedCents : null,
    projects: projectRows,
  };
}
