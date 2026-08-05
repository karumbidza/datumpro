import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { listCalendarTasks } from '@/lib/data/project-calendar';
import { ProjectCalendar } from '@/components/project/project-calendar';
import { LiveRefresh } from '@/components/live-refresh';
import { PageContainer } from '@/components/shell/page-container';

export default async function ProjectCalendarPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const tasks = await listCalendarTasks(projectId);

  return (
    <PageContainer width="6xl" className="space-y-8">
      <LiveRefresh subscriptions={[{ table: 'tasks', filter: `project_id=eq.${projectId}` }]} />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {project.name} — tasks by scheduled date
        </p>
      </header>
      <ProjectCalendar tasks={tasks} projectId={projectId} />
    </PageContainer>
  );
}
