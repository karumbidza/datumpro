import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { getDashboardData } from '@/lib/data/dashboard';
import { StatCards } from '@/components/dashboard/stat-cards';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';
import { Button } from '@/components/ui/button';

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const { counts, tasks } = await getDashboardData(project.org_id, projectId);

  return (
    <div className="mx-auto flex max-w-[1152px] flex-col gap-8 px-10 py-8">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.client_name && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{project.client_name}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/projects/${projectId}/reports/new`}>
            <Button variant="secondary">New site report</Button>
          </Link>
          <Link href={`/projects/${projectId}/tasks/new`}>
            <Button>New task</Button>
          </Link>
        </div>
      </header>

      <StatCards counts={counts} />

      <TimelineOverview tasks={tasks} />
    </div>
  );
}
