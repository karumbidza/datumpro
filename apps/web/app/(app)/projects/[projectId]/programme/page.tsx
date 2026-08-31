import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myProjectRole } from '@/lib/data/members';
import { myOrgRole } from '@/lib/data/tasks';
import { getProgrammeData } from '@/lib/data/programme';
import { Programme } from '@/components/programme/programme';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';

export default async function ProjectProgrammePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [orgRole, projectRole, data] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    getProgrammeData(projectId),
  ]);
  const canModerate = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';

  return (
    <PageContainer width="full" className="space-y-6">
      <PageHeader
        title="Programme"
        subtitle={<>{project.name} — the schedule by date, with the critical path and dependencies</>}
      />
      <Programme projectId={projectId} orgId={project.org_id} data={data} canModerate={canModerate} />
    </PageContainer>
  );
}
