import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import { listProjectsOverview } from '@/lib/data/projects-overview';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { FolderOpen } from '@/components/icons';
import { ProjectOverviewCard } from '@/components/projects/project-overview-card';

export default async function ProjectsPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const [projects, ctx] = await Promise.all([listProjectsOverview(), getActiveContext()]);
  const canCreate = ctx?.active ? can(ctx.active.role, 'project:create') : false;

  const totalTasks = projects.reduce((s, p) => s + p.totalTasks, 0);
  const doneTasks = projects.reduce((s, p) => s + p.doneTasks, 0);
  const portfolioPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

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
        <div className="mt-6 flex flex-col gap-2">
          {projects.map((p) => (
            <ProjectOverviewCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
