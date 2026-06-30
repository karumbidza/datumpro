import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { listTasksByProject, type TaskRow } from '@/lib/data/tasks';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TASK_STATUSES, type TaskStatus } from '@datumpro/shared/domain';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  submitted: 'Awaiting sign-off',
  blocked: 'Blocked',
  done: 'Done',
};
const PRIORITY_TONE = { urgent: 'amber', high: 'amber', medium: 'neutral', low: 'neutral' } as const;

export default async function TaskBoardPage({
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
  const tasks = await listTasksByProject(projectId);

  const byStatus = (s: TaskStatus): TaskRow[] => tasks.filter((t) => t.status === s);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
            ← {project.name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tasks</h1>
        </div>
        <Link href={`/projects/${projectId}/tasks/new`}>
          <Button>New task</Button>
        </Link>
      </header>

      {tasks.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No tasks yet — create the first one.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {TASK_STATUSES.map((status) => (
            <section key={status}>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {STATUS_LABEL[status]}
                <span className="rounded-full bg-zinc-100 px-1.5 text-[10px] dark:bg-zinc-800">
                  {byStatus(status).length}
                </span>
              </h2>
              <ul className="space-y-2">
                {byStatus(status).map((t) => (
                  <li key={t.id}>
                    <Link href={`/projects/${projectId}/tasks/${t.id}`}>
                      <Card className="p-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                        <p className="text-sm font-medium leading-snug">{t.title}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                          {t.due_date && <span className="text-[11px] text-zinc-400">{t.due_date}</span>}
                        </div>
                        {t.status === 'blocked' && t.blocker_description && (
                          <p className="mt-2 line-clamp-2 text-[11px] text-amber-600 dark:text-amber-400">
                            🚧 {t.blocker_description}
                          </p>
                        )}
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
