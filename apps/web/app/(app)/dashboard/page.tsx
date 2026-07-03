import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { getDashboardData } from '@/lib/data/dashboard';
import { getPortfolioData } from '@/lib/data/portfolio';
import {
  homePersona,
  listPendingApprovals,
  listMyOpenTasks,
  listManagedProjects,
} from '@/lib/data/home';
import { listMyPayments } from '@/lib/data/payments';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';
import { KpiRow } from '@/components/dashboard/kpi-row';
import { InsightBanner } from '@/components/dashboard/insight-banner';
import { StatusChart, ProgressTrend } from '@/components/dashboard/portfolio-charts';
import { RecentProjectsTable, UpcomingTasksTable } from '@/components/dashboard/portfolio-tables';
import { ApprovalsInbox } from '@/components/dashboard/approvals-inbox';
import { MyTasksCard } from '@/components/dashboard/my-tasks-card';
import { ManagedProjectsCard } from '@/components/dashboard/managed-projects-card';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatLongDate } from '@/lib/date';
import { can } from '@datumpro/shared/access';
import { formatUsd } from '@datumpro/shared/domain';

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
  const persona = homePersona(active.role);
  const [displayName, approvals] = await Promise.all([
    resolveDisplayName(ctx.userId, ctx.email),
    listPendingApprovals(active.orgId, ctx.userId, active.role),
  ]);

  const newProject = canCreate ? (
    <Link href="/projects/new">
      <Button>New project</Button>
    </Link>
  ) : null;

  // ── Portfolio home — owner / admin / finance ──────────────────────────────
  if (persona === 'portfolio') {
    const [{ counts, tasks }, portfolio] = await Promise.all([
      getDashboardData(active.orgId),
      getPortfolioData(active.orgId),
    ]);
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-6 py-8 xl:px-10">
        <Greeting
          name={displayName}
          subtitle={`Here's what's happening across ${active.name} today · ${formatLongDate(new Date())}`}
          action={newProject}
        />
        {approvals.length > 0 && <ApprovalsInbox items={approvals} />}
        <InsightBanner counts={counts} />
        <KpiRow kpis={portfolio.kpis} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <StatusChart data={portfolio.statusDistribution} />
          <ProgressTrend series={portfolio.progressSeries} />
        </div>
        <TimelineOverview tasks={tasks} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <UpcomingTasksTable tasks={portfolio.upcomingTasks} />
          <RecentProjectsTable projects={portfolio.recentProjects} />
        </div>
      </div>
    );
  }

  // ── Delivery cockpit — PM ─────────────────────────────────────────────────
  if (persona === 'delivery') {
    const [managed, myTasks] = await Promise.all([
      listManagedProjects(active.orgId, ctx.userId, active.role),
      listMyOpenTasks(ctx.userId),
    ]);
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <Greeting
          name={displayName}
          subtitle={`Your delivery overview · ${formatLongDate(new Date())}`}
          action={newProject}
        />
        {approvals.length > 0 && <ApprovalsInbox items={approvals} />}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ManagedProjectsCard projects={managed} />
          <MyTasksCard tasks={myTasks} />
        </div>
      </div>
    );
  }

  // ── Personal home — member / contractor / viewer ──────────────────────────
  const [myTasks, myPay] = await Promise.all([
    listMyOpenTasks(ctx.userId),
    listMyPayments(ctx.userId),
  ]);
  const hasPay = myPay.summary.earnedCents > 0;
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <Greeting name={displayName} subtitle={`Here's your work today · ${formatLongDate(new Date())}`} />
      {approvals.length > 0 && <ApprovalsInbox items={approvals} />}
      <MyTasksCard tasks={myTasks} />
      {hasPay && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>My payments</CardTitle>
            <Link href="/payments" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
              View all →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Earned" value={formatUsd(myPay.summary.earnedCents)} />
            <Stat label="Awaiting" value={formatUsd(myPay.summary.claimedCents)} tone="amber" />
            <Stat label="Paid" value={formatUsd(myPay.summary.paidCents)} tone="green" />
          </div>
        </Card>
      )}
    </div>
  );
}

function Greeting({ name, subtitle, action }: { name: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-2xl">
          Welcome back, {name}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'green' }) {
  const color =
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'green'
        ? 'text-green-600 dark:text-green-400'
        : 'text-zinc-900 dark:text-white';
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`font-semibold tabular-nums ${color}`}>{value}</p>
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
