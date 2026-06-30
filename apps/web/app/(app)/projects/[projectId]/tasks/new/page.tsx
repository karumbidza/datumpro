import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { listOrgMembers } from '@/lib/data/tasks';
import { createTask } from '../actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TASK_PRIORITIES } from '@datumpro/shared/domain';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function NewTaskPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  const members = await listOrgMembers(project.org_id);

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href={`/projects/${projectId}/tasks`} className="text-xs text-zinc-500 hover:underline">
        ← Tasks
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New task</h1>

      <Card className="mt-6">
        <form action={createTask} className="space-y-4">
          <input type="hidden" name="projectId" value={projectId} />
          <div>
            <label className="mb-1 block text-sm font-medium">Title</label>
            <input name="title" required placeholder="e.g. Pour ground-floor slab" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <textarea name="description" rows={3} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Priority</label>
              <select name="priority" defaultValue="medium" className={inputClass}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Assignee</label>
              <select name="assigneeId" defaultValue="" className={inputClass}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Start</label>
              <input type="date" name="plannedStartDate" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">End</label>
              <input type="date" name="plannedEndDate" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Due</label>
              <input type="date" name="dueDate" className={inputClass} />
            </div>
          </div>
          <div className="pt-2">
            <Button type="submit">Create task</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
