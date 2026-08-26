import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getTask } from '@/lib/data/tasks';
import { listProjectMembers } from '@/lib/data/members';
import { updateTask } from '../../actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from '@datumpro/shared/domain';

import { inputClass } from '@/components/ui/form';

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ projectId: string; taskId: string }>;
}) {
  const { projectId, taskId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const task = await getTask(taskId);
  if (!task) notFound();
  const members = await listProjectMembers(projectId);

  return (
    <PageContainer width="xl">
      <PageHeader
        backHref={`/projects/${projectId}/tasks/${taskId}`}
        backLabel={task.title}
        title="Edit task"
      />

      <Card className="mt-6">
        <form action={updateTask} className="space-y-4">
          <input type="hidden" name="taskId" value={taskId} />
          <div>
            <label className="mb-1 block text-sm font-medium">Title</label>
            <input name="title" required defaultValue={task.title} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <textarea name="description" rows={3} defaultValue={task.description ?? ''} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Priority</label>
              <select name="priority" defaultValue={task.priority} className={inputClass}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Assignee</label>
              <select name="assigneeId" defaultValue={task.assignee_id ?? ''} className={inputClass}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Start</label>
              <input type="date" name="plannedStartDate" defaultValue={task.planned_start_date ?? ''} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                End <span className="font-normal text-zinc-400 dark:text-zinc-500">· due date</span>
              </label>
              <input type="date" name="plannedEndDate" defaultValue={task.planned_end_date ?? ''} className={inputClass} />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit">Save changes</Button>
            <Link href={`/projects/${projectId}/tasks/${taskId}`}>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </PageContainer>
  );
}
