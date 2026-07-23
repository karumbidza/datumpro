import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myOrgRole } from '@/lib/data/tasks';
import { myProjectRole } from '@/lib/data/members';
import { getProjectSetup } from '@/lib/data/project-setup';
import { Card } from '@/components/ui/card';
import { Users, Settings, ChevronRight } from '@/components/icons';

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [orgRole, projectRole, setup] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    getProjectSetup(projectId),
  ]);
  // Settings is a management surface — org admin/owner or the project's PM only.
  const canManage = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
  if (!canManage) redirect(`/projects/${projectId}`);

  return (
    <PageContainer width="3xl">
      <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Manage this project — its team and its setup.
      </p>

      <section className="mt-6 space-y-4">
        <Link href={`/projects/${projectId}/setup`} className="block">
          <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
            <div className="flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                <Settings size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Project setup</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {setup.pct >= 100
                    ? 'Complete — client, budget, schedule and team are all set'
                    : `${setup.pct}% complete · ${setup.total - setup.done} item${
                        setup.total - setup.done === 1 ? '' : 's'
                      } outstanding`}
                </p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-zinc-400" />
            </div>
          </Card>
        </Link>

        <Link href={`/projects/${projectId}/team`} className="block">
          <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
            <div className="flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                <Users size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Team</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Who&apos;s on this project and what they can do
                </p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-zinc-400" />
            </div>
          </Card>
        </Link>
      </section>
    </PageContainer>
  );
}
