import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { getDashboardData } from '@/lib/data/dashboard';
import { getPortfolioData } from '@/lib/data/portfolio';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';
import { KpiRow } from '@/components/dashboard/kpi-row';
import { InsightBanner } from '@/components/dashboard/insight-banner';
import { StatusChart, ProgressTrend } from '@/components/dashboard/portfolio-charts';
import { RecentProjectsTable, UpcomingTasksTable } from '@/components/dashboard/portfolio-tables';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatLongDate } from '@/lib/date';
import { can, permissionsFor } from '@datumpro/shared/access';

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
            Create your company to get started.
          </p>
        </div>
        <Link href="/orgs/new">
          <Button>Create company</Button>
        </Link>
      </main>
    );
  }

  const { active } = ctx;
  const canCreate = can(active.role, 'project:create');
  const [{ counts, tasks }, portfolio, displayName] = await Promise.all([
    getDashboardData(active.orgId),
    getPortfolioData(active.orgId),
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

      {/* Attention surface — every live signal as a chip */}
      <InsightBanner counts={counts} />

      {/* Portfolio KPIs — the single stat row */}
      <KpiRow kpis={portfolio.kpis} />

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StatusChart data={portfolio.statusDistribution} />
        <ProgressTrend series={portfolio.progressSeries} />
      </div>

      {/* Timeline / Gantt (all projects) */}
      <TimelineOverview tasks={tasks} />

      {/* Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UpcomingTasksTable tasks={portfolio.upcomingTasks} />
        <RecentProjectsTable projects={portfolio.recentProjects} />
      </div>

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
