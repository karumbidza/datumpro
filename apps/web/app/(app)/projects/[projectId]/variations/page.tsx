import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myProjectRole } from '@/lib/data/members';
import { myOrgRole } from '@/lib/data/tasks';
import { listProjectVariations } from '@/lib/data/variations';
import { VariationsRegister } from '@/components/variations/variations';
import { LiveRefresh } from '@/components/live-refresh';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';

export default async function ProjectVariationsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [orgRole, projectRole, { variations, totals }] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    listProjectVariations(projectId),
  ]);
  const canModerate = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';

  return (
    <PageContainer width="4xl" className="space-y-6">
      <LiveRefresh subscriptions={[{ table: 'variation_orders', filter: `project_id=eq.${projectId}` }]} />
      <PageHeader
        title="Variations"
        subtitle={<>{project.name} — variation orders: scope changes, cost & time impact, approvals</>}
      />
      <VariationsRegister projectId={projectId} variations={variations} totals={totals} canModerate={canModerate} />
    </PageContainer>
  );
}
