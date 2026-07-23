import { createClient } from '@/lib/supabase/server';

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

  const owed: OwedTask[] = tasks.map((t) => {
    const committed = t.awarded_cost_cents ?? 0;
    const paid = paidByTask.get(t.id) ?? 0;
    const pending = pendingByTask.get(t.id) ?? 0;
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
      requestableCents: Math.max(0, committed - paid - pending),
    };
  });

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
