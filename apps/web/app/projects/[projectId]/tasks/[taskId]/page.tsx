import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getTask, listOrgMembers, myOrgRole } from '@/lib/data/tasks';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TASK_SIGNOFF_ROLES } from '@datumpro/shared/domain';
import { startTask, submitTask, approveTask, rejectTask, raiseBlocker, resolveBlocker } from '../actions';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const STATUS_TONE = { done: 'green', submitted: 'blue', blocked: 'amber', in_progress: 'blue', todo: 'neutral' } as const;

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; taskId: string }>;
}) {
  const { projectId, taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const task = await getTask(taskId);
  if (!task) notFound();

  const [members, role] = await Promise.all([listOrgMembers(task.org_id), myOrgRole(task.org_id)]);
  const assigneeName = members.find((m) => m.userId === task.assignee_id)?.name ?? 'Unassigned';
  const isLead = !!role && (TASK_SIGNOFF_ROLES as readonly string[]).includes(role);
  const isAssignee = task.assignee_id === user.id;
  const canAct = isAssignee || isLead;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/projects/${projectId}/tasks`} className="text-xs text-zinc-500 hover:underline">
        ← Tasks
      </Link>
      <div className="mt-1 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
        <Badge tone={STATUS_TONE[task.status]}>{task.status.replace('_', ' ')}</Badge>
      </div>

      <Card className="mt-6 space-y-2 text-sm">
        <Row label="Assignee" value={assigneeName} />
        <Row label="Priority" value={task.priority} />
        <Row label="SLA" value={task.sla_status.replace('_', ' ')} />
        {task.due_date && <Row label="Due" value={task.due_date} />}
        {task.description && <p className="pt-2 text-zinc-600 dark:text-zinc-300">{task.description}</p>}
        {task.status === 'blocked' && task.blocker_description && (
          <p className="rounded-md bg-amber-50 p-2 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            🚧 {task.blocker_description}
          </p>
        )}
        {task.rejection_reason && task.status === 'in_progress' && (
          <p className="rounded-md bg-red-50 p-2 text-red-700 dark:bg-red-500/10 dark:text-red-400">
            ✗ Sent back: {task.rejection_reason}
          </p>
        )}
        {task.completion_notes && (
          <p className="text-zinc-600 dark:text-zinc-300">📝 {task.completion_notes}</p>
        )}
      </Card>

      {/* Status-aware actions. The DB enforces the real rules (e.g. only a lead
          can approve to DONE) regardless of what's shown. */}
      {task.status !== 'done' && canAct && (
        <div className="mt-6 space-y-4">
          {task.status === 'todo' && (
            <form action={startTask}>
              <input type="hidden" name="taskId" value={taskId} />
              <Button type="submit">Start task</Button>
            </form>
          )}

          {task.status === 'in_progress' && (
            <>
              <Card>
                <CardTitle>Submit for sign-off</CardTitle>
                <form action={submitTask} className="mt-3 space-y-3">
                  <input type="hidden" name="taskId" value={taskId} />
                  <textarea name="notes" rows={3} required placeholder="What was completed?" className={inputClass} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="declaration" /> I confirm this work is complete and accurate.
                  </label>
                  <Button type="submit">Submit</Button>
                </form>
              </Card>
              <Card>
                <CardTitle>Raise a blocker</CardTitle>
                <form action={raiseBlocker} className="mt-3 space-y-3">
                  <input type="hidden" name="taskId" value={taskId} />
                  <textarea name="description" rows={2} required placeholder="What's blocking you?" className={inputClass} />
                  <Button type="submit" variant="secondary">Raise blocker</Button>
                </form>
              </Card>
            </>
          )}

          {task.status === 'submitted' && isLead && (
            <Card>
              <CardTitle>Review submission</CardTitle>
              <form action={approveTask} className="mt-3">
                <input type="hidden" name="taskId" value={taskId} />
                <Button type="submit">Approve (mark done)</Button>
              </form>
              <form action={rejectTask} className="mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <input type="hidden" name="taskId" value={taskId} />
                <textarea name="reason" rows={2} required placeholder="Reason for sending back" className={inputClass} />
                <Button type="submit" variant="secondary">Reject</Button>
              </form>
            </Card>
          )}

          {task.status === 'blocked' && isLead && (
            <form action={resolveBlocker}>
              <input type="hidden" name="taskId" value={taskId} />
              <Button type="submit">Resolve blocker (resume, credit deadline)</Button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
