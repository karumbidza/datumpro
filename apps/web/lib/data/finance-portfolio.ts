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
}

export interface OrgFinanceOverview {
  totals: {
    budgetCents: number;
    invoicedCents: number;
    paidCents: number;
    outstandingCents: number;
  };
  /** Collection rate = paid / invoiced (0–1); null when nothing is invoiced. */
  collectionRate: number | null;
  projects: ProjectFinanceRow[];
}

/** Portfolio-wide money view for a single org. Four org-scoped queries — no
 *  per-project fan-out. RLS still applies, so a caller only ever aggregates
 *  rows they're allowed to read; the hub is gated to owner/admin/finance who
 *  can see the whole org. Paid is attributed to a project via invoice → project
 *  (payments carry invoice_id, not project_id) and counts only confirmed money. */
export async function orgFinanceOverview(orgId: string): Promise<OrgFinanceOverview> {
  const supabase = await createClient();

  const [projectsRes, budgetRes, invoicesRes, paymentsRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase.from('budget_lines').select('project_id, budget_amount_cents').eq('org_id', orgId),
    supabase.from('invoices').select('id, project_id, status, total_cents').eq('org_id', orgId),
    supabase.from('payments').select('invoice_id, amount_cents, status').eq('org_id', orgId),
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
      return acc;
    },
    { budgetCents: 0, invoicedCents: 0, paidCents: 0, outstandingCents: 0 },
  );

  return {
    totals,
    collectionRate: totals.invoicedCents > 0 ? totals.paidCents / totals.invoicedCents : null,
    projects: projectRows,
  };
}
