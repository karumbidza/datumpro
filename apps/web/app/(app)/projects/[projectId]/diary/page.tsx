import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myProjectRole } from '@/lib/data/members';
import { myOrgRole } from '@/lib/data/tasks';
import { listSiteDiaryEntries } from '@/lib/data/site-diary';
import { SiteDiary } from '@/components/diary/site-diary';
import { LiveRefresh } from '@/components/live-refresh';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';

export default async function ProjectDiaryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [orgRole, projectRole, entries] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    listSiteDiaryEntries(projectId),
  ]);
  const canModerate = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';

  return (
    <PageContainer width="4xl" className="space-y-6">
      <LiveRefresh
        subscriptions={[
          { table: 'site_diary_entries', filter: `project_id=eq.${projectId}` },
          { table: 'site_diary_photos', filter: `project_id=eq.${projectId}` },
        ]}
      />
      <PageHeader
        title="Site Diary"
        subtitle={<>{project.name} — the daily record of weather, labour, plant, deliveries and work done</>}
      />
      <SiteDiary
        projectId={projectId}
        orgId={project.org_id}
        entries={entries}
        canModerate={canModerate}
        currentUserId={user.id}
      />
    </PageContainer>
  );
}
