import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import { listProjectsOverview } from '@/lib/data/projects-overview';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ListHeader } from '@/components/ui/list-header';
import { FolderOpen } from '@/components/icons';
import { ProjectOverviewCard, PROJECT_ROW_GRID } from '@/components/projects/project-overview-card';

// Wound-down projects sink to the bottom so the active portfolio stays in view —
// the same "closed last" treatment as the tasks board.
const CLOSED_STATUSES = new Set(['completed', 'archived']);

export default async function ProjectsPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const ctx = await getActiveContext();
  const projects = ctx?.active ? await listProjectsOverview(ctx.active.orgId) : [];
  const canCreate = ctx?.active ? can(ctx.active.role, 'project:create') : false;

  const totalTasks = projects.reduce((s, p) => s + p.totalTasks, 0);
  const doneTasks = projects.reduce((s, p) => s + p.doneTasks, 0);
  const portfolioPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  const orderedProjects = [...projects].sort(
    (a, b) => Number(CLOSED_STATUSES.has(a.status)) - Number(CLOSED_STATUSES.has(b.status)),
  );

  return (
    <PageContainer width="6xl">
      <PageHeader
        title="Projects"
        subtitle={
          projects.length > 0
            ? `${projects.length} project${projects.length === 1 ? '' : 's'} · ${portfolioPct}% overall progress`
            : undefined
        }
        actions={
          canCreate ? (
            <Link href="/projects/new">
              <Button>New project</Button>
            </Link>
          ) : undefined
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={FolderOpen}
          title="No projects yet"
          hint="Create your first project to start planning tasks, tenders and site reports."
        />
      ) : (
        <div className="mt-6">
          <ListHeader style={PROJECT_ROW_GRID}>
            <div>Project</div>
            <div>Progress</div>
            <div className="text-right">%</div>
            <div className="text-right">Value</div>
            <div>Status</div>
            <div />
          </ListHeader>

          <div className="flex flex-col gap-2 pt-2">
            {orderedProjects.map((p) => (
              <ProjectOverviewCard key={p.id} project={p} />
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
