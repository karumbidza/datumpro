import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '@/components/shell/page-container';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { LiveRefresh } from '@/components/live-refresh';
import { listProjectActivityFull } from '@/lib/data/tasks';
import { listProjectMembers } from '@/lib/data/members';
import { ActivityFeed } from '@/components/project/activity-feed';

export default async function ProjectActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [items, members] = await Promise.all([
    listProjectActivityFull(projectId),
    listProjectMembers(projectId),
  ]);

  return (
    <PageContainer width="3xl" className="flex flex-col gap-6">
      <LiveRefresh
        subscriptions={[{ table: 'task_activity', filter: `org_id=eq.${project.org_id}` }]}
      />
      <div>
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Activity</h1>
      </div>
      <ActivityFeed
        items={items}
        members={members.map((m) => ({ userId: m.userId, name: m.name }))}
        projectId={projectId}
      />
    </PageContainer>
  );
}
