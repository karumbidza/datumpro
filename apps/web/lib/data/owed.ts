import { createClient } from '@/lib/supabase/server';
import type { PaymentRequestStatus } from '@datumpro/shared/domain';

/** One task the signed-in contractor is owed on: committed = the approved plan's
 *  awarded amount, netted against their paid + pending payment requests. */
export interface OwedTask {
  taskId: string;
  title: string;
  projectId: string;
  orgId: string;
  projectName: string;
  committedCents: number; // approved awarded amount (the agreed price)
  paidCents: number; // paid payment requests on this task
  pendingCents: number; // requested / approved (not yet paid)
  outstandingCents: number; // committed − paid
  requestableCents: number; // committed − paid − pending (what a new request may claim)
}

export interface OwedSummary {
  earnedCents: number; // Σ committed (approved plan amounts)
  awaitingCents: number; // Σ pending (in flight)
  paidCents: number;
  outstandingCents: number; // earned − paid
}

type ProjJoin = { name: string | null } | { name: string | null }[] | null;
const projName = (p: ProjJoin): string => (Array.isArray(p) ? p[0]?.name : p?.name) ?? 'Project';

/** What the signed-in contractor is owed — their tasks with an approved plan
 *  (committed = awarded cost), netted against paid + pending payment requests.
 *  Mirrors the mobile earnings model, but sourced from approved plans rather than
 *  the retired payment-schedule draws. */
export async function listMyOwed(userId: string): Promise<{ tasks: OwedTask[]; summary: OwedSummary }> {
  const supabase = await createClient();

  const { data: taskRows } = await supabase
    .from('tasks')
    .select('id, title, org_id, project_id, awarded_cost_cents, plan_approved_at, projects(name)')
    .eq('assignee_id', userId)
    .not('plan_approved_at', 'is', null);

  const tasks = ((taskRows ?? []) as {
    id: string;
    title: string;
    org_id: string;
    project_id: string;
    awarded_cost_cents: number | null;
    projects: ProjJoin;
  }[]).filter((t) => (t.awarded_cost_cents ?? 0) > 0);

  const empty = { earnedCents: 0, awaitingCents: 0, paidCents: 0, outstandingCents: 0 };
  if (tasks.length === 0) return { tasks: [], summary: empty };

  const { data: reqRows } = await supabase
    .from('contractor_payment_requests')
    .select('task_id, amount_cents, status')
    .eq('contractor_id', userId)
    .in('task_id', tasks.map((t) => t.id));

  const paidByTask = new Map<string, number>();
  const pendingByTask = new Map<string, number>();
  for (const r of (reqRows ?? []) as { task_id: string | null; amount_cents: number; status: string }[]) {
    if (!r.task_id) continue;
    if (r.status === 'paid') paidByTask.set(r.task_id, (paidByTask.get(r.task_id) ?? 0) + r.amount_cents);
    else if (r.status === 'requested' || r.status === 'approved')
      pendingByTask.set(r.task_id, (pendingByTask.get(r.task_id) ?? 0) + r.amount_cents);
  }

  // Progress-gated: what's actually claimable is the milestone entitlement (net of
  // retention), not the full committed value.
  const entitlementByTask = new Map<string, number>();
  await Promise.all(
    tasks.map(async (t) => {
      const { data } = await supabase.rpc('task_payment_entitlement_cents', { p_task_id: t.id });
      entitlementByTask.set(t.id, (data as number | null) ?? 0);
    }),
  );

  const owed: OwedTask[] = tasks.map((t) => {
    const committed = t.awarded_cost_cents ?? 0;
    const paid = paidByTask.get(t.id) ?? 0;
    const pending = pendingByTask.get(t.id) ?? 0;
    const entitlement = entitlementByTask.get(t.id) ?? 0;
    return {
      taskId: t.id,
      title: t.title,
      projectId: t.project_id,
      orgId: t.org_id,
      projectName: projName(t.projects),
      committedCents: committed,
      paidCents: paid,
      pendingCents: pending,
      outstandingCents: committed - paid,
      requestableCents: Math.max(0, entitlement - paid - pending),
    };
  });

  // Advance recoupment (full offset): project-wide, cash claimable = max(0, Σ
  // entitlements − advances). Reduce each task's requestable so the UI matches the
  // DB gate — the first <advance> of earned work is offset before any cash flows.
  const byProject = new Map<string, OwedTask[]>();
  for (const o of owed) {
    const arr = byProject.get(o.projectId) ?? [];
    arr.push(o);
    byProject.set(o.projectId, arr);
  }
  const advanceByProject = new Map<string, number>();
  await Promise.all(
    [...byProject.keys()].map(async (pid) => {
      const { data } = await supabase.rpc('project_contractor_advance_cents', {
        p_project_id: pid,
        p_contractor: userId,
      });
      advanceByProject.set(pid, (data as number | null) ?? 0);
    }),
  );
  for (const [pid, group] of byProject) {
    const advance = advanceByProject.get(pid) ?? 0;
    if (advance <= 0) continue;
    const projEntitlement = group.reduce((s, o) => s + (entitlementByTask.get(o.taskId) ?? 0), 0);
    const projClaimed = group.reduce((s, o) => s + o.paidCents + o.pendingCents, 0);
    let budget = Math.max(0, Math.max(0, projEntitlement - advance) - projClaimed);
    for (const o of group) {
      const capped = Math.min(o.requestableCents, budget);
      o.requestableCents = capped;
      budget -= capped;
    }
  }

  const summary = owed.reduce(
    (a, o) => {
      a.earnedCents += o.committedCents;
      a.paidCents += o.paidCents;
      a.awaitingCents += o.pendingCents;
      return a;
    },
    { ...empty },
  );
  summary.outstandingCents = summary.earnedCents - summary.paidCents;

  return { tasks: owed, summary };
}

export interface TaskPaymentRequest {
  id: string;
  title: string;
  amountCents: number;
  status: PaymentRequestStatus;
  invoiceUrl: string | null;
  reviewNote: string | null;
  paidReference: string | null;
}

export interface TaskPaymentInfo {
  committedCents: number;
  paidCents: number;
  pendingCents: number;
  outstandingCents: number;
  requestableCents: number;
  requests: TaskPaymentRequest[];
}

/** One task's payment position + its requests, for the per-task Payment tab.
 *  Returns null when the task has no approved plan amount to invoice. RLS scopes
 *  the requests (the assignee and the managers see them). */
export async function getTaskPaymentInfo(taskId: string): Promise<TaskPaymentInfo | null> {
  const supabase = await createClient();
  const { data: t } = await supabase
    .from('tasks')
    .select('awarded_cost_cents, plan_approved_at, project_id, assignee_id')
    .eq('id', taskId)
    .maybeSingle();
  const task = t as {
    awarded_cost_cents: number | null;
    plan_approved_at: string | null;
    project_id: string;
    assignee_id: string | null;
  } | null;
  if (!task || !task.plan_approved_at || (task.awarded_cost_cents ?? 0) <= 0) return null;
  const committed = task.awarded_cost_cents ?? 0;

  const { data: reqRows } = await supabase
    .from('contractor_payment_requests')
    .select('id, title, amount_cents, status, invoice_path, review_note, paid_reference, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  const rows = (reqRows ?? []) as {
    id: string;
    title: string;
    amount_cents: number;
    status: PaymentRequestStatus;
    invoice_path: string | null;
    review_note: string | null;
    paid_reference: string | null;
  }[];

  let paid = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === 'paid') paid += r.amount_cents;
    else if (r.status === 'requested' || r.status === 'approved') pending += r.amount_cents;
  }

  // Progress-gated: claimable now is the milestone entitlement (net of retention).
  const { data: entitlement } = await supabase.rpc('task_payment_entitlement_cents', { p_task_id: taskId });
  let claimable = Math.max(0, ((entitlement as number | null) ?? 0) - paid - pending);

  // Advance recoupment (full offset): cap this task's claim by the project-wide
  // cash left after the contractor's advance is recouped from earned work.
  if (task.assignee_id) {
    const { data: advance } = await supabase.rpc('project_contractor_advance_cents', {
      p_project_id: task.project_id,
      p_contractor: task.assignee_id,
    });
    if (((advance as number | null) ?? 0) > 0) {
      const { data: projEnt } = await supabase.rpc('project_contractor_entitlement_cents', {
        p_project_id: task.project_id,
        p_contractor: task.assignee_id,
      });
      const { data: claimRows } = await supabase
        .from('contractor_payment_requests')
        .select('amount_cents, status')
        .eq('project_id', task.project_id)
        .eq('contractor_id', task.assignee_id)
        .eq('kind', 'milestone');
      const projClaimed = ((claimRows ?? []) as { amount_cents: number; status: string }[])
        .filter((r) => r.status !== 'rejected' && r.status !== 'cancelled')
        .reduce((s, r) => s + r.amount_cents, 0);
      const projClaimable = Math.max(
        0,
        Math.max(0, ((projEnt as number | null) ?? 0) - ((advance as number | null) ?? 0)) - projClaimed,
      );
      claimable = Math.min(claimable, projClaimable);
    }
  }

  const paths = [...new Set(rows.map((r) => r.invoice_path).filter(Boolean))] as string[];
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('project-media').createSignedUrls(paths, 3600);
    for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    }
  }

  return {
    committedCents: committed,
    paidCents: paid,
    pendingCents: pending,
    outstandingCents: committed - paid,
    requestableCents: claimable,
    requests: rows.map((r) => ({
      id: r.id,
      title: r.title,
      amountCents: r.amount_cents,
      status: r.status,
      invoiceUrl: r.invoice_path ? urlByPath.get(r.invoice_path) ?? null : null,
      reviewNote: r.review_note,
      paidReference: r.paid_reference,
    })),
  };
}
