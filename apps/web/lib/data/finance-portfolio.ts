import { createClient } from '@/lib/supabase/server';

/** One project's contractor-payment position (buy-side), in integer cents. */
export interface ProjectContractorFinance {
  projectId: string;
  name: string;
  status: string;
  /** Project budget = its contract value. */
  budgetCents: number;
  /** Committed to contractors — sum of scheduled draws. */
  committedCents: number;
  /** Paid to contractors — draws marked paid. */
  paidCents: number;
  /** Still owed — committed minus paid. */
  outstandingCents: number;
  /** Payment requests awaiting action (requested or approved, not yet paid). */
  pendingRequestsCount: number;
  pendingRequestsCents: number;
}

export interface OrgContractorFinance {
  totals: {
    budgetCents: number;
    committedCents: number;
    paidCents: number;
    outstandingCents: number;
    pendingRequestsCount: number;
    pendingRequestsCents: number;
  };
  projects: ProjectContractorFinance[];
}

/** Portfolio-wide contractor-payment view for one org (buy-side, request-and-pay).
 *  Three org-scoped queries — no per-project fan-out. RLS still applies, so a
 *  caller only aggregates rows they may read; the hub is gated to owner/admin/
 *  finance/PM. Budget is the project's contract value; committed/paid come from
 *  the payment schedule (draws); pending is the payment requests still to action. */
export async function orgContractorFinance(orgId: string): Promise<OrgContractorFinance> {
  const supabase = await createClient();

  const [projectsRes, drawsRes, requestsRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status, contract_value_cents')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase.from('payment_schedule').select('project_id, amount_cents, status').eq('org_id', orgId),
    supabase
      .from('contractor_payment_requests')
      .select('project_id, amount_cents, status')
      .eq('org_id', orgId),
  ]);

  const projects = (projectsRes.data ?? []) as {
    id: string;
    name: string;
    status: string;
    contract_value_cents: number;
  }[];
  const draws = (drawsRes.data ?? []) as { project_id: string; amount_cents: number; status: string }[];
  const requests = (requestsRes.data ?? []) as {
    project_id: string;
    amount_cents: number;
    status: string;
  }[];

  // Seed a row per project so the whole portfolio shows, including $0 ones.
  const rows = new Map<string, ProjectContractorFinance>();
  for (const p of projects) {
    rows.set(p.id, {
      projectId: p.id,
      name: p.name,
      status: p.status,
      budgetCents: p.contract_value_cents ?? 0,
      committedCents: 0,
      paidCents: 0,
      outstandingCents: 0,
      pendingRequestsCount: 0,
      pendingRequestsCents: 0,
    });
  }

  for (const d of draws) {
    const row = rows.get(d.project_id);
    if (!row) continue;
    row.committedCents += d.amount_cents ?? 0;
    if (d.status === 'paid') row.paidCents += d.amount_cents ?? 0;
  }

  for (const r of requests) {
    if (r.status !== 'requested' && r.status !== 'approved') continue;
    const row = rows.get(r.project_id);
    if (!row) continue;
    row.pendingRequestsCount += 1;
    row.pendingRequestsCents += r.amount_cents ?? 0;
  }

  const projectRows = [...rows.values()];
  for (const row of projectRows) row.outstandingCents = row.committedCents - row.paidCents;

  const totals = projectRows.reduce(
    (acc, r) => {
      acc.budgetCents += r.budgetCents;
      acc.committedCents += r.committedCents;
      acc.paidCents += r.paidCents;
      acc.outstandingCents += r.outstandingCents;
      acc.pendingRequestsCount += r.pendingRequestsCount;
      acc.pendingRequestsCents += r.pendingRequestsCents;
      return acc;
    },
    {
      budgetCents: 0,
      committedCents: 0,
      paidCents: 0,
      outstandingCents: 0,
      pendingRequestsCount: 0,
      pendingRequestsCents: 0,
    },
  );

  return { totals, projects: projectRows };
}
