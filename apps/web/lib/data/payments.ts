import { createClient } from '@/lib/supabase/server';

export type ScheduleStatus = 'pending' | 'invoiced' | 'paid';

export interface PaymentLine {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  name: string;
  kind: string | null;
  amountCents: number;
  status: ScheduleStatus;
  paidAt: string | null;
  paidReference: string | null;
  dueDate: string | null;
  claimedAt: string | null;
  claimNote: string | null;
}

export interface PaymentSummary {
  committedCents: number;
  paidCents: number;
  outstandingCents: number;
}

const COLUMNS =
  'id, task_id, name, kind, amount_cents, status, paid_at, paid_reference, due_date, claimed_at, claim_note';

function toLine(r: RawLine, taskTitle: string | null): PaymentLine {
  return {
    id: r.id,
    taskId: r.task_id,
    taskTitle,
    name: r.name,
    kind: r.kind,
    amountCents: r.amount_cents,
    status: r.status,
    paidAt: r.paid_at,
    paidReference: r.paid_reference,
    dueDate: r.due_date,
    claimedAt: r.claimed_at,
    claimNote: r.claim_note,
  };
}

interface RawLine {
  id: string;
  task_id: string | null;
  name: string;
  kind: string | null;
  amount_cents: number;
  status: ScheduleStatus;
  paid_at: string | null;
  paid_reference: string | null;
  due_date: string | null;
  claimed_at: string | null;
  claim_note: string | null;
}

/** Payment draws for one task. RLS: staff, the project PM, and the assigned
 *  contractor only. */
export async function listTaskPayments(taskId: string): Promise<PaymentLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payment_schedule')
    .select(COLUMNS)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  return ((data ?? []) as RawLine[]).map((r) => toLine(r, null));
}

/** All contractor draws in a project the caller may see, with task titles and a
 *  committed/paid/outstanding summary. */
export async function listProjectPayments(
  projectId: string,
): Promise<{ lines: PaymentLine[]; summary: PaymentSummary }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payment_schedule')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as RawLine[];

  const taskIds = [...new Set(rows.map((r) => r.task_id).filter(Boolean))] as string[];
  let titles = new Map<string, string>();
  if (taskIds.length > 0) {
    const { data: tasks } = await supabase.from('tasks').select('id, title').in('id', taskIds);
    titles = new Map(((tasks ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]));
  }

  const lines = rows.map((r) => toLine(r, r.task_id ? titles.get(r.task_id) ?? null : null));
  const committedCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const paidCents = lines.filter((l) => l.status === 'paid').reduce((s, l) => s + l.amountCents, 0);

  return {
    lines,
    summary: { committedCents, paidCents, outstandingCents: committedCents - paidCents },
  };
}

export interface MyPaymentLine extends PaymentLine {
  projectId: string;
  projectName: string;
}

export interface MyPaymentsSummary {
  earnedCents: number;
  claimedCents: number;
  paidCents: number;
  outstandingCents: number;
}

/** The signed-in contractor's own draws across every project — their earnings
 *  view. Scoped to tasks assigned to them (staff/PM would otherwise see all
 *  draws under RLS). earned = every draw; claimed = awaiting payment;
 *  paid = settled; outstanding = earned − paid. */
export async function listMyPayments(
  userId: string,
): Promise<{ lines: MyPaymentLine[]; summary: MyPaymentsSummary }> {
  const supabase = await createClient();

  const { data: myTasks } = await supabase
    .from('tasks')
    .select('id, title, project_id')
    .eq('assignee_id', userId);
  const tasks = (myTasks ?? []) as { id: string; title: string; project_id: string }[];
  if (tasks.length === 0) {
    return { lines: [], summary: { earnedCents: 0, claimedCents: 0, paidCents: 0, outstandingCents: 0 } };
  }

  const taskMeta = new Map(tasks.map((t) => [t.id, t]));
  const { data: drawRows } = await supabase
    .from('payment_schedule')
    .select(`${COLUMNS}, project_id`)
    .in(
      'task_id',
      tasks.map((t) => t.id),
    )
    .order('created_at', { ascending: false });
  const rows = (drawRows ?? []) as (RawLine & { project_id: string })[];

  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  let projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projects } = await supabase.from('projects').select('id, name').in('id', projectIds);
    projectNames = new Map(((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  }

  const lines: MyPaymentLine[] = rows.map((r) => ({
    ...toLine(r, r.task_id ? taskMeta.get(r.task_id)?.title ?? null : null),
    projectId: r.project_id,
    projectName: projectNames.get(r.project_id) ?? 'Project',
  }));

  const summary = lines.reduce(
    (acc, l) => {
      acc.earnedCents += l.amountCents;
      if (l.status === 'paid') acc.paidCents += l.amountCents;
      if (l.status === 'invoiced') acc.claimedCents += l.amountCents;
      return acc;
    },
    { earnedCents: 0, claimedCents: 0, paidCents: 0, outstandingCents: 0 },
  );
  summary.outstandingCents = summary.earnedCents - summary.paidCents;

  return { lines, summary };
}
