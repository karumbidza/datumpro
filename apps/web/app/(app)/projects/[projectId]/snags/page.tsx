import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myProjectRole } from '@/lib/data/members';
import { listProjectMembers } from '@/lib/data/members';
import { myOrgRole } from '@/lib/data/tasks';
import { listProjectSnags, getProjectDlp } from '@/lib/data/snags';
import { getProjectRetention } from '@/lib/data/retention';
import type { SnagContractor } from '@/lib/data/snags-types';
import { SnagsRegister } from '@/components/snags/snags';
import { LiveRefresh } from '@/components/live-refresh';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';

export default async function ProjectSnagsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [orgRole, projectRole, snags, dlp, members] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    listProjectSnags(projectId),
    getProjectDlp(projectId),
    listProjectMembers(projectId),
  ]);
  const canModerate = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';

  // Contractors assignable on this project; managers also see each one's
  // available retention so they can charge a repair against it.
  const retention = canModerate ? await getProjectRetention(projectId) : null;
  const availableByContractor = new Map(
    (retention?.contractors ?? []).map((c) => [c.contractorId, c.availableCents]),
  );
  const contractors: SnagContractor[] = members
    .filter((m) => m.role === 'contractor' && m.status === 'active')
    .map((m) => ({
      userId: m.userId,
      name: m.name,
      availableRetentionCents: canModerate ? (availableByContractor.get(m.userId) ?? 0) : null,
    }));

  return (
    <PageContainer width="4xl" className="space-y-6">
      <LiveRefresh
        subscriptions={[
          { table: 'snags', filter: `project_id=eq.${projectId}` },
          { table: 'snag_photos', filter: `project_id=eq.${projectId}` },
        ]}
      />
      <PageHeader
        title="Snagging"
        subtitle={<>{project.name} — the defects register: raise, assign, track to a verified fix</>}
      />
      <SnagsRegister
        projectId={projectId}
        orgId={project.org_id}
        snags={snags}
        dlp={dlp}
        contractors={contractors}
        canModerate={canModerate}
        currentUserId={user.id}
      />
    </PageContainer>
  );
}
