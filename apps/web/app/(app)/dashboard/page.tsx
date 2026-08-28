import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { getPortfolioTimeline, getDashboardData } from '@/lib/data/dashboard';
import { getPortfolioData } from '@/lib/data/portfolio';
import {
  homePersona,
  listPendingApprovals,
  listMyOpenTasks,
  listManagedProjects,
} from '@/lib/data/home';
import { listMyOwed } from '@/lib/data/owed';
import { TimelineOverview } from '@/components/dashboard/timeline-overview';
import { KpiRow } from '@/components/dashboard/kpi-row';
import { UpcomingTasksTable } from '@/components/dashboard/portfolio-tables';
import { DeliveryFocus } from '@/components/dashboard/delivery-focus';
import { ApprovalsInbox } from '@/components/dashboard/approvals-inbox';
import { MyTasksCard } from '@/components/dashboard/my-tasks-card';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { joinOrgByDomain } from './join-actions';
import { LiveRefresh } from '@/components/live-refresh';
import { formatLongDate } from '@/lib/date';
import { can } from '@datumpro/shared/access';
import { formatUsd } from '@datumpro/shared/domain';

export default async function DashboardPage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');

  // No organisation yet → onboarding (rendered without the sidebar by the layout).
  if (!ctx.active) {
    const supabase = await createClient();
    const { data: joinable } = await supabase.rpc('find_joinable_org');
    const offer = ((joinable ?? []) as { org_id: string; org_name: string }[])[0] ?? null;

    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{offer ? 'Join your company' : 'Create your company'}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {offer ? 'Your company is already on DatumPro.' : 'One organisation holds your projects, team, and tenders.'}
          </p>
        </div>

        {offer && (
          <Card className="w-full text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{offer.org_name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Join as a member</p>
              </div>
              <form action={joinOrgByDomain}>
                <input type="hidden" name="orgId" value={offer.org_id} />
                <SubmitButton pendingText="Joining…">Join</SubmitButton>
              </form>
            </div>
          </Card>
        )}

        {offer && <div className="text-xs text-zinc-400 dark:text-zinc-500">or</div>}

        <Link href="/orgs/new">
          <Button variant={offer ? 'secondary' : undefined}>Create a new company</Button>
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

  // Org-wide (broad) live subscriptions — the portfolio home spans every project.
  const live = (
    <LiveRefresh
      subscriptions={[
        { table: 'tasks', filter: `org_id=eq.${active.orgId}` },
        { table: 'site_reports', filter: `org_id=eq.${active.orgId}` },
        { table: 'contractor_payment_requests', filter: `org_id=eq.${active.orgId}` },
        { table: 'projects', filter: `org_id=eq.${active.orgId}` },
        { table: 'approvals', filter: `org_id=eq.${active.orgId}` },
      ]}
    />
  );

  // ── Portfolio home — owner / admin / finance ──────────────────────────────
  if (persona === 'portfolio') {
    const [projectTimeline, portfolio] = await Promise.all([
      getPortfolioTimeline(active.orgId),
      getPortfolioData(active.orgId),
    ]);
    return (
      <PageContainer width="6xl" className="flex flex-col gap-8">
        {live}
        <Greeting
          name={displayName}
          subtitle={`${active.name} · ${formatLongDate(new Date())}`}
          action={newProject}
        />
        <KpiRow kpis={portfolio.kpis} />
        <TimelineOverview tasks={projectTimeline} unit="project" />
        {approvals.length > 0 && <ApprovalsInbox items={approvals} />}
        <UpcomingTasksTable tasks={portfolio.upcomingTasks} />
      </PageContainer>
    );
  }

  // ── Delivery cockpit — PM ─────────────────────────────────────────────────
  if (persona === 'delivery') {
    const [managed, dash] = await Promise.all([
      listManagedProjects(active.orgId, ctx.userId, active.role),
      getDashboardData(active.orgId),
    ]);
    // Task-level timeline + action counts, scoped to the projects this PM runs.
    const managedIds = new Set(managed.map((m) => m.id));
    const timelineTasks = dash.tasks.filter((t) => managedIds.has(t.project_id));
    const now = Date.now();
    const blockers = timelineTasks.filter((t) => t.status === 'blocked' || t.sla_status === 'blocked').length;
    const overdue = timelineTasks.filter(
      (t) =>
        t.status !== 'done' &&
        ((t.due_date && new Date(t.due_date).getTime() < now) || t.sla_status === 'breached'),
    ).length;
    return (
      <PageContainer width="6xl" className="space-y-8">
        {live}
        <Greeting
          name={displayName}
          subtitle={`Delivery overview · ${formatLongDate(new Date())}`}
          action={newProject}
        />
        <DeliveryFocus approvals={approvals} blockers={blockers} overdue={overdue} />
        <TimelineOverview tasks={timelineTasks} unit="task" />
      </PageContainer>
    );
  }

  // ── Personal home — member / contractor / viewer ──────────────────────────
  const [myTasks, myPay] = await Promise.all([
    listMyOpenTasks(ctx.userId),
    listMyOwed(ctx.userId),
  ]);
  const hasPay = myPay.summary.earnedCents > 0;
  return (
    <PageContainer width="3xl" className="space-y-8">
      {live}
      <Greeting name={displayName} subtitle={`Your work · ${formatLongDate(new Date())}`} />
      {approvals.length > 0 && <ApprovalsInbox items={approvals} />}
      <MyTasksCard tasks={myTasks} />
      {hasPay && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>My payments</CardTitle>
            <Link href="/payments" className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline dark:text-brand-400">
              View all →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Earned" value={formatUsd(myPay.summary.earnedCents)} />
            <Stat label="Awaiting" value={formatUsd(myPay.summary.awaitingCents)} tone="amber" />
            <Stat label="Paid" value={formatUsd(myPay.summary.paidCents)} tone="green" />
          </div>
        </Card>
      )}
    </PageContainer>
  );
}

function Greeting({ name, subtitle, action }: { name: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-2xl">
          {name}
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
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
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
  // Older owners were seeded with display_name = their email (before setup asked
  // for a name). Treat an email-shaped value as unset so we never greet with a
  // full address — fall back to the local part.
  const raw = (data as { display_name: string | null } | null)?.display_name;
  const name = raw && !raw.includes('@') ? raw : null;
  return name || email?.split('@')[0] || 'there';
}
