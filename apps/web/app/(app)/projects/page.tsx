import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import { listProjectsOverview } from '@/lib/data/projects-overview';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { getPortfolioTimeline } from '@/lib/data/dashboard';
import { Button } from '@/components/ui/button';
import { ProjectOverviewCard } from '@/components/projects/project-overview-card';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';

export default async function ProjectsPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const [projects, ctx] = await Promise.all([listProjectsOverview(), getActiveContext()]);
  const canCreate = ctx?.active ? can(ctx.active.role, 'project:create') : false;
  const projectTimeline = ctx?.active ? await getPortfolioTimeline(ctx.active.orgId) : [];

  const totalTasks = projects.reduce((s, p) => s + p.totalTasks, 0);
  const doneTasks = projects.reduce((s, p) => s + p.doneTasks, 0);
  const portfolioPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          {projects.length > 0 && (
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {projects.length} project{projects.length === 1 ? '' : 's'} · {portfolioPct}% overall progress
            </p>
          )}
        </div>
        {canCreate && (
          <Link href="/projects/new">
            <Button>New project</Button>
          </Link>
        )}
      </header>

      {projects.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          No projects yet — create your first one.
        </p>
      ) : (
        <>
          <div className="mt-6">
            <TimelineOverview tasks={projectTimeline} unit="project" />
          </div>
          <div className="mt-6 flex flex-col gap-2">
            {projects.map((p) => (
              <ProjectOverviewCard key={p.id} project={p} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
