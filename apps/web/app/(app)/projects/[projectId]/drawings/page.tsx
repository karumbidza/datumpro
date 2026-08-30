import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myProjectRole } from '@/lib/data/members';
import { myOrgRole } from '@/lib/data/tasks';
import { listProjectDrawings } from '@/lib/data/drawings';
import { DrawingsRegister } from '@/components/drawings/drawings';
import { LiveRefresh } from '@/components/live-refresh';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';

export default async function ProjectDrawingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [orgRole, projectRole, drawings] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    listProjectDrawings(projectId),
  ]);
  const canManage = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';

  return (
    <PageContainer width="4xl" className="space-y-6">
      <LiveRefresh
        subscriptions={[
          { table: 'drawings', filter: `project_id=eq.${projectId}` },
          { table: 'drawing_revisions', filter: `project_id=eq.${projectId}` },
        ]}
      />
      <PageHeader
        title="Drawings"
        subtitle={<>{project.name} — the drawing register, with revisions and issue status</>}
      />
      <DrawingsRegister projectId={projectId} orgId={project.org_id} drawings={drawings} canManage={canManage} />
    </PageContainer>
  );
}
