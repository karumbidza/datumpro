import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** The date held retention becomes releasable = practical completion + the agreed
 *  defects-liability period. Mirrors project_retention_release_at in the DB. */
export function retentionReleaseAt(practicalCompletionAt: string | null, periodMonths: number | null): string | null {
  if (!practicalCompletionAt) return null;
  const d = new Date(practicalCompletionAt);
  d.setMonth(d.getMonth() + (periodMonths ?? 0));
  return d.toISOString();
}

function isReleasable(releaseAt: string | null): boolean {
  return releaseAt != null && Date.now() >= new Date(releaseAt).getTime();
}

export interface ContractorRetention {
  contractorId: string;
  contractorName: string | null;
  withheldCents: number; // pool held across their approved tasks
  deductedCents: number; // spent on repairs during the period
  claimedCents: number; // retention requests raised (not rejected/cancelled)
  availableCents: number; // still owed once releasable = withheld − deducted − claimed
}

export interface RetentionDeductionRow {
  id: string;
  contractorId: string;
  contractorName: string | null;
  amountCents: number;
  reason: string;
  createdAt: string;
}

export interface ProjectRetention {
  retentionPct: number | null;
  periodMonths: number | null;
  practicalCompletionAt: string | null;
  releaseAt: string | null;
  releasable: boolean;
  contractors: ContractorRetention[];
  deductions: RetentionDeductionRow[];
  totalWithheldCents: number;
  totalAvailableCents: number;
}

/** Manager view: every contractor's retention position on a project, plus the
 *  deductions ledger and the release timing. RLS scopes reads to staff/PM/finance. */
export async function getProjectRetention(projectId: string): Promise<ProjectRetention | null> {
  const supabase = await createClient();

  const { data: proj } = await supabase
    .from('projects')
    .select('retention_pct, retention_period_months, practical_completion_at')
    .eq('id', projectId)
    .maybeSingle();
  if (!proj) return null;
  const p = proj as {
    retention_pct: number | null;
    retention_period_months: number | null;
    practical_completion_at: string | null;
  };
  const releaseAt = retentionReleaseAt(p.practical_completion_at, p.retention_period_months);

  // Contractors with an approved (priced) task on this project — they may hold retention.
  const { data: taskRows } = await supabase
    .from('tasks')
    .select('assignee_id')
    .eq('project_id', projectId)
    .not('plan_approved_at', 'is', null)
    .not('assignee_id', 'is', null);
  const contractorIds = [...new Set(((taskRows ?? []) as { assignee_id: string | null }[])
    .map((t) => t.assignee_id)
    .filter(Boolean) as string[])];

  // Deductions (spent on repairs) and retention claims, grouped by contractor.
  const [{ data: dedRows }, { data: claimRows }] = await Promise.all([
    supabase
      .from('retention_deductions')
      .select('id, contractor_id, amount_cents, reason, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    supabase
      .from('contractor_payment_requests')
      .select('contractor_id, amount_cents, status')
      .eq('project_id', projectId)
      .eq('kind', 'retention'),
  ]);

  const deductedByContractor = new Map<string, number>();
  for (const d of (dedRows ?? []) as { contractor_id: string; amount_cents: number }[]) {
    deductedByContractor.set(d.contractor_id, (deductedByContractor.get(d.contractor_id) ?? 0) + d.amount_cents);
  }
  const claimedByContractor = new Map<string, number>();
  for (const c of (claimRows ?? []) as { contractor_id: string; amount_cents: number; status: string }[]) {
    if (c.status === 'rejected' || c.status === 'cancelled') continue;
    claimedByContractor.set(c.contractor_id, (claimedByContractor.get(c.contractor_id) ?? 0) + c.amount_cents);
  }

  // Pool per contractor (non-trivial milestone/retention math) via the DB function.
  const poolByContractor = new Map<string, number>();
  await Promise.all(
    contractorIds.map(async (cid) => {
      const { data } = await supabase.rpc('project_contractor_retention_cents', {
        p_project_id: projectId,
        p_contractor: cid,
      });
      poolByContractor.set(cid, (data as number | null) ?? 0);
    }),
  );

  // Names for contractors that appear anywhere (tasks or deductions).
  const allIds = [...new Set([...contractorIds, ...deductedByContractor.keys()])];
  const names = new Map<string, string>();
  if (allIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name, email').in('id', allIds);
    for (const pr of (profs ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
      names.set(pr.id, pr.display_name || pr.email || 'Contractor');
    }
  }

  const contractors: ContractorRetention[] = contractorIds
    .map((cid) => {
      const withheld = poolByContractor.get(cid) ?? 0;
      const deducted = deductedByContractor.get(cid) ?? 0;
      const claimed = claimedByContractor.get(cid) ?? 0;
      return {
        contractorId: cid,
        contractorName: names.get(cid) ?? null,
        withheldCents: withheld,
        deductedCents: deducted,
        claimedCents: claimed,
        availableCents: Math.max(0, withheld - deducted - claimed),
      };
    })
    .filter((c) => c.withheldCents > 0 || c.deductedCents > 0 || c.claimedCents > 0)
    .sort((a, b) => b.withheldCents - a.withheldCents);

  const deductions: RetentionDeductionRow[] = ((dedRows ?? []) as {
    id: string;
    contractor_id: string;
    amount_cents: number;
    reason: string;
    created_at: string;
  }[]).map((d) => ({
    id: d.id,
    contractorId: d.contractor_id,
    contractorName: names.get(d.contractor_id) ?? null,
    amountCents: d.amount_cents,
    reason: d.reason,
    createdAt: d.created_at,
  }));

  return {
    retentionPct: p.retention_pct,
    periodMonths: p.retention_period_months,
    practicalCompletionAt: p.practical_completion_at,
    releaseAt,
    releasable: isReleasable(releaseAt),
    contractors,
    deductions,
    totalWithheldCents: contractors.reduce((s, c) => s + c.withheldCents, 0),
    totalAvailableCents: contractors.reduce((s, c) => s + c.availableCents, 0),
  };
}

export interface MyRetentionRow {
  projectId: string;
  projectName: string;
  orgId: string;
  withheldCents: number;
  deductedCents: number;
  claimedCents: number;
  availableCents: number;
  releaseAt: string | null;
  releasable: boolean;
}

/** Contractor view: the signed-in user's retention across the projects they work
 *  on — what's held, what's been spent on repairs, and what's releasable now. */
export async function listMyRetention(userId: string): Promise<MyRetentionRow[]> {
  const supabase = await createClient();

  const { data: taskRows } = await supabase
    .from('tasks')
    .select('project_id, org_id, projects(name, retention_period_months, practical_completion_at)')
    .eq('assignee_id', userId)
    .not('plan_approved_at', 'is', null);

  type Row = {
    project_id: string;
    org_id: string;
    projects:
      | { name: string | null; retention_period_months: number | null; practical_completion_at: string | null }
      | { name: string | null; retention_period_months: number | null; practical_completion_at: string | null }[]
      | null;
  };
  const projects = new Map<string, { orgId: string; name: string; period: number | null; pc: string | null }>();
  for (const t of (taskRows ?? []) as Row[]) {
    if (projects.has(t.project_id)) continue;
    const pj = Array.isArray(t.projects) ? t.projects[0] : t.projects;
    projects.set(t.project_id, {
      orgId: t.org_id,
      name: pj?.name ?? 'Project',
      period: pj?.retention_period_months ?? null,
      pc: pj?.practical_completion_at ?? null,
    });
  }
  if (projects.size === 0) return [];

  const projectIds = [...projects.keys()];

  // Deductions + retention claims for this contractor across those projects.
  const [{ data: dedRows }, { data: claimRows }] = await Promise.all([
    supabase
      .from('retention_deductions')
      .select('project_id, amount_cents')
      .eq('contractor_id', userId)
      .in('project_id', projectIds),
    supabase
      .from('contractor_payment_requests')
      .select('project_id, amount_cents, status')
      .eq('contractor_id', userId)
      .eq('kind', 'retention')
      .in('project_id', projectIds),
  ]);
  const deductedByProject = new Map<string, number>();
  for (const d of (dedRows ?? []) as { project_id: string; amount_cents: number }[]) {
    deductedByProject.set(d.project_id, (deductedByProject.get(d.project_id) ?? 0) + d.amount_cents);
  }
  const claimedByProject = new Map<string, number>();
  for (const c of (claimRows ?? []) as { project_id: string; amount_cents: number; status: string }[]) {
    if (c.status === 'rejected' || c.status === 'cancelled') continue;
    claimedByProject.set(c.project_id, (claimedByProject.get(c.project_id) ?? 0) + c.amount_cents);
  }

  const pools = await Promise.all(
    projectIds.map(async (pid) => {
      const { data } = await supabase.rpc('project_contractor_retention_cents', {
        p_project_id: pid,
        p_contractor: userId,
      });
      return [pid, (data as number | null) ?? 0] as const;
    }),
  );
  const poolByProject = new Map(pools);

  return projectIds
    .map((pid) => {
      const meta = projects.get(pid)!;
      const withheld = poolByProject.get(pid) ?? 0;
      const deducted = deductedByProject.get(pid) ?? 0;
      const claimed = claimedByProject.get(pid) ?? 0;
      const releaseAt = retentionReleaseAt(meta.pc, meta.period);
      return {
        projectId: pid,
        projectName: meta.name,
        orgId: meta.orgId,
        withheldCents: withheld,
        deductedCents: deducted,
        claimedCents: claimed,
        availableCents: Math.max(0, withheld - deducted - claimed),
        releaseAt,
        releasable: isReleasable(releaseAt),
      };
    })
    .filter((r) => r.withheldCents > 0 || r.deductedCents > 0 || r.claimedCents > 0)
    .sort((a, b) => b.withheldCents - a.withheldCents);
}
