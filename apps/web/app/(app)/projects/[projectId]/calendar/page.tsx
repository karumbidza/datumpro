import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { listCalendarTasks } from '@/lib/data/project-calendar';
import { listCalendarActionItems } from '@/lib/data/action-items';
import { listCalendarEvents } from '@/lib/data/events';
import { ProjectCalendar } from '@/components/project/project-calendar';
import { LiveRefresh } from '@/components/live-refresh';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';

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

  const [tasks, actionItems, events] = await Promise.all([
    listCalendarTasks(projectId),
    listCalendarActionItems(projectId),
    listCalendarEvents(projectId),
  ]);

  return (
    <PageContainer width="6xl" className="space-y-8">
      <LiveRefresh
        subscriptions={[
          { table: 'tasks', filter: `project_id=eq.${projectId}` },
          { table: 'action_items', filter: `project_id=eq.${projectId}` },
          { table: 'project_events', filter: `project_id=eq.${projectId}` },
        ]}
      />
      <PageHeader
        title="Calendar"
        subtitle={<>{project.name} — tasks, to-dos and events by date</>}
      />
      <ProjectCalendar tasks={tasks} actionItems={actionItems} events={events} projectId={projectId} />
    </PageContainer>
  );
}
