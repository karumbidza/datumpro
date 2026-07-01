import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { getDashboardData } from '@/lib/data/dashboard';
import { listProjects } from '@/lib/data/projects';
import { StatCards } from '@/components/dashboard/stat-cards';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatLongDate } from '@/lib/date';
import { formatUsd } from '@datumpro/shared/domain';
import { permissionsFor } from '@datumpro/shared/access';

const PROJECT_STATUS_TONE = {
  active: 'green',
  planning: 'blue',
  on_hold: 'amber',
  completed: 'neutral',
  archived: 'neutral',
} as const;

export default async function DashboardPage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');

  // No organisation yet → onboarding (rendered without the sidebar by the layout).
  if (!ctx.active) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome to DatumPro</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Create your organisation to get started.
          </p>
        </div>
        <Link href="/orgs/new">
          <Button>Create organisation</Button>
        </Link>
      </main>
    );
  }

  const { active } = ctx;
  const canCreate = active.role === 'owner' || active.role === 'admin';
  const [{ counts, tasks }, projects, displayName] = await Promise.all([
    getDashboardData(active.orgId),
    listProjects(),
    resolveDisplayName(ctx.userId, ctx.email),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8 xl:px-10">
      {/* Welcome header */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="mb-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-2xl">
            Welcome back, {displayName}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Here&apos;s what&apos;s happening across {active.name} today · {formatLongDate(new Date())}
          </p>
        </div>
        {canCreate && (
          <Link href="/projects/new">
            <Button>New project</Button>
          </Link>
        )}
      </div>

      {/* Action-required stat cards (company-wide) */}
      <StatCards counts={counts} />

      {/* Timeline / Gantt (all projects) */}
      <TimelineOverview tasks={tasks} />

      {/* Projects portfolio */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Projects</h2>
          <Link href="/projects" className="text-xs text-zinc-500 hover:underline">
            View all
          </Link>
        </div>
        {projects.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No projects yet.{' '}
              {canCreate ? 'Create your first one from the switcher above.' : 'Ask an admin to add you to a project.'}
            </p>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`}>
                  <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">{p.name}</h3>
                        {p.client_name && (
                          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {p.client_name}
                          </p>
                        )}
                      </div>
                      <Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                      Contract {formatUsd(p.contract_value_cents)}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Capabilities */}
      <Card>
        <CardTitle>Your capabilities</CardTitle>
        <ul className="mt-3 flex flex-wrap gap-2">
          {permissionsFor(active.role).map((p) => (
            <li
              key={p}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
            >
              {p}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

async function resolveDisplayName(userId: string, email: string | null): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();
  const name = (data as { display_name: string | null } | null)?.display_name;
  return name || email?.split('@')[0] || 'there';
}
