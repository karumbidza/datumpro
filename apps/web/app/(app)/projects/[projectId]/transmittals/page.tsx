import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myProjectRole, listProjectMembers } from '@/lib/data/members';
import { myOrgRole } from '@/lib/data/tasks';
import { listProjectTransmittals, listIssuableDrawings } from '@/lib/data/transmittals';
import { TransmittalsRegister } from '@/components/transmittals/transmittals';
import { LiveRefresh } from '@/components/live-refresh';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';

export default async function ProjectTransmittalsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [orgRole, projectRole, transmittals, drawings, members] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    listProjectTransmittals(projectId),
    listIssuableDrawings(projectId),
    listProjectMembers(projectId),
  ]);
  const canManage = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';

  const memberOptions = members
    .filter((m) => m.status === 'active')
    .map((m) => ({ userId: m.userId, name: m.name }));

  return (
    <PageContainer width="4xl" className="space-y-6">
      <LiveRefresh
        subscriptions={[
          { table: 'transmittals', filter: `project_id=eq.${projectId}` },
          { table: 'transmittal_items', filter: `project_id=eq.${projectId}` },
        ]}
      />
      <PageHeader
        title="Transmittals"
        subtitle={<>{project.name} — a record of which drawings were issued, to whom, and when</>}
      />
      <TransmittalsRegister
        projectId={projectId}
        transmittals={transmittals}
        drawings={drawings}
        members={memberOptions}
        canManage={canManage}
      />
    </PageContainer>
  );
}
