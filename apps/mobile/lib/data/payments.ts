import { supabase, currentUser} from '../supabase';

export type DrawStatus = 'pending' | 'invoiced' | 'paid';

export interface MyDraw {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string;
  projectName: string;
  name: string;
  amountCents: number;
  status: DrawStatus;
  claimedAt: string | null;
  claimNote: string | null;
  paidAt: string | null;
  paidReference: string | null;
}

export interface MyPaymentsSummary {
  earnedCents: number;
  claimedCents: number;
  paidCents: number;
  outstandingCents: number;
}

const EMPTY: MyPaymentsSummary = { earnedCents: 0, claimedCents: 0, paidCents: 0, outstandingCents: 0 };

interface RawDraw {
  id: string;
  task_id: string | null;
  project_id: string;
  name: string;
  amount_cents: number;
  status: DrawStatus;
  claimed_at: string | null;
  claim_note: string | null;
  paid_at: string | null;
  paid_reference: string | null;
}

/** The signed-in contractor's own draws across every project — their earnings.
 *  Scoped to tasks assigned to them (staff/PM would otherwise see all draws
 *  under RLS). Mirrors the web listMyPayments. */
export async function listMyPayments(): Promise<{ lines: MyDraw[]; summary: MyPaymentsSummary }> {
  const user = await currentUser();
  const me = user?.id;
  if (!me) return { lines: [], summary: EMPTY };

  const { data: taskRows } = await supabase
    .from('tasks')
    .select('id, title, project_id')
    .eq('assignee_id', me);
  const tasks = (taskRows ?? []) as { id: string; title: string; project_id: string }[];
  if (tasks.length === 0) return { lines: [], summary: EMPTY };

  const taskMeta = new Map(tasks.map((t) => [t.id, t]));
  const { data: drawRows } = await supabase
    .from('payment_schedule')
    .select(
      'id, task_id, project_id, name, amount_cents, status, claimed_at, claim_note, paid_at, paid_reference',
    )
    .in(
      'task_id',
      tasks.map((t) => t.id),
    )
    .order('created_at', { ascending: false });
  const rows = (drawRows ?? []) as RawDraw[];

  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  let projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projects } = await supabase.from('projects').select('id, name').in('id', projectIds);
    projectNames = new Map(((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  }

  const lines: MyDraw[] = rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    taskTitle: r.task_id ? taskMeta.get(r.task_id)?.title ?? null : null,
    projectId: r.project_id,
    projectName: projectNames.get(r.project_id) ?? 'Project',
    name: r.name,
    amountCents: r.amount_cents,
    status: r.status,
    claimedAt: r.claimed_at,
    claimNote: r.claim_note,
    paidAt: r.paid_at,
    paidReference: r.paid_reference,
  }));

  const summary = lines.reduce(
    (acc, l) => {
      acc.earnedCents += l.amountCents;
      if (l.status === 'paid') acc.paidCents += l.amountCents;
      if (l.status === 'invoiced') acc.claimedCents += l.amountCents;
      return acc;
    },
    { ...EMPTY },
  );
  summary.outstandingCents = summary.earnedCents - summary.paidCents;

  return { lines, summary };
}

/** Raise a progress claim against a pending draw. The DB function enforces
 *  assignee-only + pending-only. */
export async function submitPaymentClaim(scheduleId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('submit_payment_claim', {
    p_schedule_id: scheduleId,
    p_note: note.trim(),
  });
  if (error) throw new Error(error.message);
}
