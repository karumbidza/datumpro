import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import {
  getTask,
  myOrgRole,
  listTaskDependencies,
  listProjectTaskOptions,
  listTaskActivity,
  listExtensionRequests,
} from '@/lib/data/tasks';
import { listProjectMembers, myProjectRole } from '@/lib/data/members';
import { listChatRoster } from '@/lib/data/chat-roster';
import { getProjectSchedule } from '@/lib/data/scheduling';
import { listTaskMedia, listSubtaskMedia } from '@/lib/data/quotes';
import { listTenderInvites, listBidLinesByContractor, listTaskDocuments } from '@/lib/data/tenders';
import { listTaskPayments } from '@/lib/data/payments';
import { getTaskConversationId, listMessages, othersMaxReadSeq } from '@/lib/data/chat';
import { TenderPanel } from '@/components/task/tender-panel';
import { BidPanel } from '@/components/task/bid-panel';
import { SubtaskPanel } from '@/components/task/subtask-panel';
import { listSubtasks } from '@/lib/data/subtasks';
import { PaymentsPanel } from '@/components/task/payments-panel';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CompletionEvidence } from '@/components/task/completion-evidence';
import { ExtensionPanel } from '@/components/task/extension-panel';
import { stepsByEntity } from '@/lib/data/approvals';
import { LiveRefresh } from '@/components/live-refresh';
import { TaskTabs, type TaskTab } from '@/components/task/task-tabs';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  startTask,
  approveTask,
  rejectTask,
  resolveBlocker,
  addDependency,
  removeDependency,
} from '../actions';
import { SubmitTaskForm } from '@/components/task/submit-task-form';
import { BlockerForm } from '@/components/task/blocker-form';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const STATUS_TONE = { done: 'green', submitted: 'blue', blocked: 'amber', in_progress: 'blue', todo: 'neutral' } as const;

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; taskId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { projectId, taskId } = await params;
  const { tab: initialTab } = await searchParams;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const task = await getTask(taskId);
  if (!task) notFound();

  const [
    members,
    orgRole,
    projectRole,
    dependencies,
    taskOptions,
    activity,
    schedule,
    tenderInvites,
    bidLinesMap,
    completionMedia,
    extensions,
    payments,
    subtasks,
    subtaskMedia,
    dmConversationId,
  ] = await Promise.all([
    listProjectMembers(projectId),
    myOrgRole(task.org_id),
    myProjectRole(projectId),
    listTaskDependencies(taskId),
    listProjectTaskOptions(projectId, taskId),
    listTaskActivity(taskId),
    getProjectSchedule(projectId),
    listTenderInvites(taskId),
    listBidLinesByContractor(taskId),
    listTaskMedia(taskId, 'completion'),
    listExtensionRequests(taskId),
    listTaskPayments(taskId),
    listSubtasks(taskId),
    listSubtaskMedia(taskId),
    getTaskConversationId(taskId),
  ]);
  const sched = schedule?.meta[taskId];
  const variationIds = subtasks.filter((s) => s.isVariation).map((s) => s.id);
  const [extSteps, planStepsMap, variationStepsMap] = await Promise.all([
    stepsByEntity('extension', extensions.map((e) => e.id)),
    stepsByEntity('task_plan', [taskId]),
    stepsByEntity('task_variation', variationIds),
  ]);
  const planSteps = planStepsMap.get(taskId) ?? [];
  const variationSteps = Object.fromEntries(variationStepsMap);
  // BoQ / invoice PDFs. RLS returns only what the viewer may see (plan doc, own
  // bid doc, or — for the PM — every bid doc).
  const taskDocs = await listTaskDocuments(taskId);
  const planDocs = taskDocs.filter((d) => d.contractorId === null);
  const myBidDocs = taskDocs.filter((d) => d.contractorId === user.id);
  const docsByBidder: Record<string, typeof taskDocs> = {};
  for (const d of taskDocs) if (d.contractorId) (docsByBidder[d.contractorId] ??= []).push(d);

  // Task DM (created on assignment; visible only to staff / PM / the assigned contractor).
  let dm: { id: string; messages: Awaited<ReturnType<typeof listMessages>>; othersRead: number } | null = null;
  if (dmConversationId) {
    const [messages, othersRead] = await Promise.all([
      listMessages(dmConversationId, user.id),
      othersMaxReadSeq(dmConversationId, user.id),
    ]);
    dm = { id: dmConversationId, messages, othersRead };
  }
  const chatNames = Object.fromEntries(members.map((m) => [m.userId, m.name]));
  const meName = chatNames[user.id] ?? user.email?.split('@')[0] ?? 'You';

  // People rail for the task discussion: its participants (the assignee + the
  // project's PMs — the same people the DM is visible to). Project-level stats.
  const taskParticipantIds = Array.from(
    new Set(
      [task.assignee_id, ...members.filter((m) => m.role === 'pm').map((m) => m.userId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  const taskRoster = dm ? await listChatRoster(projectId, taskParticipantIds) : [];

  const contractorMembers = members.filter((m) => m.role === 'contractor');
  const contractors = (contractorMembers.length > 0 ? contractorMembers : members).map((m) => ({
    userId: m.userId,
    name: m.name,
  }));

  const assigneeName = members.find((m) => m.userId === task.assignee_id)?.name ?? 'Unassigned';
  const acceptancePending = task.acceptance_status === 'pending';
  // Only the agreed scope (baseline + approved variations) gates completion.
  const countedSubtasks = subtasks.filter((s) => !s.isVariation || s.variationStatus === 'approved');
  const planComplete = countedSubtasks.length === 0 || countedSubtasks.every((s) => s.isDone);
  // A contractor task can't start until its priced plan is approved.
  const planNotApproved = task.acceptance_status !== null && !task.plan_approved_at;
  // Dependency block: predecessors that aren't done yet. Can't start; can still
  // be assigned/tendered. The DB enforces the start rule too.
  const waitingOn = dependencies.filter((d) => d.status !== 'done').map((d) => d.title);
  const blockedByDeps = waitingOn.length > 0 && task.status !== 'done';
  const isAssignee = task.assignee_id === user.id;
  // Sign-off authority mirrors the DB guard: org admin OR the project's PM.
  const canManage = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
  // Am I an active tender invitee (building a sealed bid)? Then I get the bid
  // editor instead of the normal plan/workflow panels.
  const myInvite = tenderInvites.find((i) => i.contractorId === user.id);
  const isBidder =
    !canManage && task.assignee_id !== user.id && !!myInvite && (myInvite.status === 'invited' || myInvite.status === 'submitted');
  const canAct = isAssignee || canManage;
  // Completion evidence is the assignee's to upload, at completion time only.
  const canUpload = isAssignee && task.status !== 'done';
  // Out to tender: no assignee yet, bids still open. Drives the "Open for bidding"
  // labelling so contractors know it's a tender, not an idle unassigned task.
  const isTendering = !task.assignee_id && tenderInvites.some((i) => i.status === 'invited' || i.status === 'submitted');
  // The assignee RAISES an extension request; the admin/PM only sees + approves.
  // Only once the work has commenced (in progress / blocked) — there's nothing to
  // extend before the task has started.
  const canRequestExtension = isAssignee && (task.status === 'in_progress' || task.status === 'blocked');
  const extensionPreStart = isAssignee && task.status === 'todo';

  const usedPredecessors = new Set(dependencies.map((d) => d.predecessorId));
  const addable = taskOptions.filter((t) => !usedPredecessors.has(t.id));

  // Status-aware workflow actions stay in the always-visible overview zone so
  // the primary CTA is never buried behind a tab. The DB enforces the real
  // rules (e.g. only a lead can approve to DONE) regardless of what's shown.
  const workflowActions =
    task.status !== 'done' && canAct && !acceptancePending && !isBidder ? (
      <div className="mt-4 space-y-4">
        {task.status === 'todo' &&
          !blockedByDeps &&
          (planNotApproved ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {task.plan_submitted_at
                ? 'Your plan is awaiting approval — you can start once it’s approved.'
                : 'Build your priced plan below and submit it for approval before starting.'}
            </p>
          ) : subtasks.length > 0 ? (
            <form action={startTask}>
              <input type="hidden" name="taskId" value={taskId} />
              <Button type="submit">Start task</Button>
            </form>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Add at least one step to your task plan below, then you can start the task.
            </p>
          ))}

        {task.status === 'in_progress' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardTitle>Submit for sign-off</CardTitle>
              {planComplete ? (
                <SubmitTaskForm taskId={taskId} />
              ) : (
                <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                  Complete every step in your task plan below before submitting for sign-off.
                </p>
              )}
            </Card>
            <Card>
              <CardTitle>Raise a blocker</CardTitle>
              <BlockerForm taskId={taskId} />
            </Card>
          </div>
        )}

        {task.status === 'submitted' && canManage && (
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

        {task.status === 'blocked' && canManage && (
          <form action={resolveBlocker}>
            <input type="hidden" name="taskId" value={taskId} />
            <Button type="submit">Resolve blocker (resume, credit deadline)</Button>
          </form>
        )}
      </div>
    ) : null;

  // Deep detail lives in tabs so the page reads at a glance instead of one long
  // scroll. Tabs only appear when they have something to show.
  const tabs: TaskTab[] = [];

  if (dm) {
    tabs.push({
      key: 'discussion',
      label: 'Discussion',
      content: (
        <ChatPanel
          className="h-[520px]"
          title="Task Discussion"
          subtitle="Private to the project manager and the assigned contractor."
          conversationId={dm.id}
          orgId={task.org_id}
          projectId={projectId}
          currentUserId={user.id}
          meName={meName}
          initialMessages={dm.messages}
          othersReadSeq={dm.othersRead}
          canPost
          canModerate={canManage}
          members={taskRoster}
        />
      ),
    });
  }

  tabs.push({
    key: 'dependencies',
    label: 'Dependencies',
    count: dependencies.length,
    content: (
      <Card>
        <CardTitle>Dependencies</CardTitle>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Predecessors that must finish (plus any lag) before this task can start.
        </p>

        {dependencies.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No dependencies.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {dependencies.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-100 p-2 dark:border-zinc-800"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={`/projects/${projectId}/tasks/${d.predecessorId}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {d.title}
                  </Link>
                  <Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge>
                  {d.lagDays > 0 && <span className="text-[11px] text-zinc-400">+{d.lagDays}d lag</span>}
                </div>
                {canManage && (
                  <form action={removeDependency}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="dependencyId" value={d.id} />
                    <Button type="submit" variant="ghost">
                      Remove
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && addable.length > 0 && (
          <form
            action={addDependency}
            className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800"
          >
            <input type="hidden" name="taskId" value={taskId} />
            <div className="min-w-48 flex-1">
              <label className="mb-1 block text-xs font-medium">Starts after</label>
              <select name="predecessorId" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Select a task…
                </option>
                {addable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs font-medium">Lag (days)</label>
              <input type="number" name="lagDays" min={0} defaultValue={0} className={inputClass} />
            </div>
            <Button type="submit">Add</Button>
          </form>
        )}
      </Card>
    ),
  });

  if (tenderInvites.length > 0 && canManage) {
    const invitedIds = new Set(tenderInvites.map((i) => i.contractorId));
    const tenderDecided = tenderInvites.some((i) => i.status === 'awarded');
    tabs.push({
      key: 'tender',
      label: 'Tender',
      count: tenderInvites.length,
      content: (
        <TenderPanel
          taskId={taskId}
          projectId={projectId}
          invites={tenderInvites}
          bidLines={Object.fromEntries(bidLinesMap)}
          bidDocs={docsByBidder}
          availableContractors={contractors.filter((c) => !invitedIds.has(c.userId))}
          canManage={canManage}
          decided={tenderDecided}
        />
      ),
    });
  }

  if (payments.length > 0) {
    tabs.push({
      key: 'payments',
      label: 'Payments',
      count: payments.length,
      content: (
        <PaymentsPanel taskId={taskId} lines={payments} canManage={canManage} isAssignee={isAssignee} />
      ),
    });
  }

  // Evidence is the assignee's to upload at completion. Managers only see the tab
  // once there's evidence to review at sign-off — never during tender/planning.
  if (isAssignee || (canManage && completionMedia.length > 0)) {
    tabs.push({
      key: 'evidence',
      label: 'Evidence',
      count: completionMedia.length,
      content: (
        <CompletionEvidence
          taskId={taskId}
          projectId={projectId}
          orgId={task.org_id}
          media={completionMedia}
          canUpload={canUpload}
          canManage={canManage}
        />
      ),
    });
  }

  tabs.push({
    key: 'extensions',
    label: 'Extensions',
    count: extensions.length,
    content: (
      <ExtensionPanel
        taskId={taskId}
        projectId={projectId}
        canRequest={canRequestExtension}
        preStart={extensionPreStart}
        requests={extensions}
        stepsByExt={Object.fromEntries(extSteps)}
        viewerRole={orgRole ?? ''}
      />
    ),
  });

  if (activity.length > 0) {
    tabs.push({
      key: 'activity',
      label: 'Activity',
      count: activity.length,
      content: (
        <ol className="space-y-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          {activity.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              <p className="text-sm text-zinc-700 dark:text-zinc-200">{a.message}</p>
              <p className="text-[11px] text-zinc-400">
                {a.userName} · {new Date(a.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      ),
    });
  }

  return (
    <PageContainer width="4xl">
      <LiveRefresh
        subscriptions={[
          { table: 'task_subtasks', filter: `task_id=eq.${taskId}` },
          { table: 'task_media', filter: `task_id=eq.${taskId}` },
          { table: 'task_extension_requests', filter: `task_id=eq.${taskId}` },
          { table: 'task_tender_invites', filter: `task_id=eq.${taskId}` },
          { table: 'task_activity', filter: `task_id=eq.${taskId}` },
          { table: 'tasks', filter: `id=eq.${taskId}` },
          { table: 'approvals', filter: `org_id=eq.${task.org_id}` },
        ]}
      />
      <Link href={`/projects/${projectId}/tasks`} className="text-xs text-zinc-500 hover:underline">
        ← Tasks
      </Link>
      <div className="mt-1 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
        <div className="flex items-center gap-2">
          {isTendering ? (
            <Badge tone="amber">{isBidder ? 'Bidding' : 'Open for bidding'}</Badge>
          ) : (
            <Badge tone={STATUS_TONE[task.status]}>{task.status.replace('_', ' ')}</Badge>
          )}
          {canManage && task.status !== 'done' && (
            <Link href={`/projects/${projectId}/tasks/${taskId}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Overview — at a glance + act. Everything else is tabbed below. */}
      <Card className="mt-4 space-y-2 text-sm">
        <Row
          label="Assignee"
          value={isTendering ? (isBidder ? 'You’re bidding on this' : 'Open for bidding') : assigneeName}
        />
        {isTendering && canManage && (
          <p className="rounded-md bg-amber-50 p-2 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            📣 Out to tender — {tenderInvites.filter((i) => i.status === 'submitted').length}/{tenderInvites.length} bid(s)
            in. Compare and award in the Tender tab.
          </p>
        )}
        <Row label="Priority" value={task.priority} />
        <Row label="SLA" value={task.sla_status.replace('_', ' ')} />
        {task.status !== 'done' && sched && (
          <Row
            label="Schedule"
            value={sched.critical ? 'On critical path' : `${sched.floatDays}d slack`}
          />
        )}
        {task.planned_start_date && <Row label="Start" value={task.planned_start_date} />}
        {task.due_date && <Row label="Due" value={task.due_date} />}
        {task.description && <p className="pt-2 text-zinc-600 dark:text-zinc-300">{task.description}</p>}
        {blockedByDeps && (
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
            <span className="text-[13px]">🔒</span> Blocked: {waitingOn.join(', ')}
          </p>
        )}
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

      {isBidder && (
        <div className="mt-4">
          <BidPanel
            taskId={taskId}
            projectId={projectId}
            orgId={task.org_id}
            bidLines={subtasks}
            docs={myBidDocs}
            submitted={myInvite?.status === 'submitted'}
            taskStart={task.planned_start_date}
            taskEnd={task.planned_end_date ?? task.due_date}
          />
        </div>
      )}

      {!isBidder && (task.assignee_id || subtasks.length > 0) && (
        <div className="mt-4">
          <SubtaskPanel
            taskId={taskId}
            projectId={projectId}
            orgId={task.org_id}
            subtasks={subtasks}
            mediaBySubtask={subtaskMedia}
            acceptanceStatus={task.acceptance_status}
            isAssignee={isAssignee}
            canManage={canManage}
            assigneeName={assigneeName}
            taskStart={task.planned_start_date}
            taskEnd={task.planned_end_date ?? task.due_date}
            taskStatus={task.status}
            planSubmittedAt={task.plan_submitted_at}
            planApprovedAt={task.plan_approved_at}
            awardedCostCents={task.awarded_cost_cents}
            planSteps={planSteps}
            variationSteps={variationSteps}
            viewerRole={orgRole ?? ''}
            planDocs={planDocs}
          />
        </div>
      )}

      {workflowActions}

      <TaskTabs tabs={tabs} initialKey={initialTab} />
    </PageContainer>
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
