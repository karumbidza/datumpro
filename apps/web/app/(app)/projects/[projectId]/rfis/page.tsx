import { notFound, redirect } from 'next/navigation';
import { getAuthUser, getActiveContext } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myProjectRole, listProjectMembers } from '@/lib/data/members';
import { myOrgRole } from '@/lib/data/tasks';
import { listProjectRfis } from '@/lib/data/rfis';
import { listProjectDrawings } from '@/lib/data/drawings';
import type { RfiDrawingRef } from '@/lib/data/rfis-types';
import { RfisRegister } from '@/components/rfis/rfis';
import { LiveRefresh } from '@/components/live-refresh';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';

export default async function ProjectRfisPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  // Internal register — external observers (client/viewer) may not see it.
  const ctx = await getActiveContext();
  if (ctx?.active?.memberType === 'client' || ctx?.active?.memberType === 'viewer') notFound();

  const [orgRole, projectRole, rfis, members, drawings] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    listProjectRfis(projectId),
    listProjectMembers(projectId),
    listProjectDrawings(projectId),
  ]);
  const canModerate = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';

  const memberOptions = members
    .filter((m) => m.status === 'active')
    .map((m) => ({ userId: m.userId, name: m.name }));
  const drawingOptions: RfiDrawingRef[] = drawings.map((d) => ({ id: d.id, number: d.number, title: d.title }));

  return (
    <PageContainer width="4xl" className="space-y-6">
      <LiveRefresh
        subscriptions={[
          { table: 'rfis', filter: `project_id=eq.${projectId}` },
          { table: 'rfi_attachments', filter: `project_id=eq.${projectId}` },
        ]}
      />
      <PageHeader
        title="RFIs"
        subtitle={<>{project.name} — requests for information, raised to a written answer</>}
      />
      <RfisRegister
        projectId={projectId}
        orgId={project.org_id}
        rfis={rfis}
        members={memberOptions}
        drawings={drawingOptions}
        canModerate={canModerate}
        currentUserId={user.id}
      />
    </PageContainer>
  );
}
