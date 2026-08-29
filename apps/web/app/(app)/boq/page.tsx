import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { createClient } from '@/lib/supabase/server';
import { listBoqs } from '@/lib/data/boq';
import { listMyTenderInvites } from '@/lib/data/tender';
import { ContractorTenderPortal } from './contractor-portal';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { theadRowClass, thClass } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BOQ_STATUS_TONE } from '@/components/ui/tones';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText } from '@/components/icons';
import { BOQ_STATUS_LABELS, type BoqStatus } from '@datumpro/shared/domain';
import { fmtMoney } from '@/lib/money';

export default async function BoqIndexPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');

  const memberType = ctx.active.memberType;
  if (memberType === 'client' || memberType === 'viewer') notFound();
  if (memberType === 'contractor') {
    const invites = await listMyTenderInvites(ctx.userId);
    return <ContractorTenderPortal invites={invites} orgName={ctx.active.name} />;
  }
  // Managers only — estimating and tendering is an owner/admin/PM activity.
  // Org owner/admin/pm qualify outright; otherwise allow anyone who is a PM on at
  // least one project (mirrors the nav gate so the shortcut and the page agree).
  let canAccess = ['owner', 'admin', 'pm'].includes(ctx.active.role);
  if (!canAccess) {
    const supabase = await createClient();
    const { count } = await supabase
      .from('project_members')
      .select('project_id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('role', 'pm')
      .eq('status', 'active');
    canAccess = (count ?? 0) > 0;
  }
  if (!canAccess) notFound();

  const boqs = await listBoqs(ctx.active.orgId);

  return (
    <PageContainer width="6xl">
      <PageHeader
        title="Bills & tenders"
        subtitle={
          <>
            Every bill across{' '}
            <span className="font-medium text-brand-600 dark:text-brand-500">{ctx.active.name}</span> — open one to
            edit or put it out to tender. Bills are created inside a project&apos;s set-up.
          </>
        }
      />

      {boqs.length === 0 ? (
        <div className="mt-8 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <EmptyState
            icon={FileText}
            title="No bills yet"
            hint="A bill of quantities belongs to a project. Open a project and create its bill from the BOQ tab — it’ll appear here."
            action={
              <Link href="/projects">
                <Button size="sm">Go to projects</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={theadRowClass}>
                <th className={thClass}>Bill</th>
                <th className={thClass}>Industry</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Project</th>
                <th className={`${thClass} text-right`}>Items</th>
                <th className={`${thClass} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {boqs.map((b) => (
                <tr
                  key={b.id}
                  className="relative cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-3">
                    {/* Stretched link: the whole row navigates (one accessible anchor
                        via after:inset-0 over the `relative` row), not just the name. */}
                    <Link
                      href={`/boq/${b.id}`}
                      className="font-medium text-zinc-900 after:absolute after:inset-0 hover:underline dark:text-zinc-100"
                    >
                      {b.name}
                    </Link>
                    {b.clientName && <p className="text-xs text-zinc-500 dark:text-zinc-400">{b.clientName}</p>}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{b.industry ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge tone={BOQ_STATUS_TONE[(b.status as BoqStatus)] ?? 'neutral'}>
                      {BOQ_STATUS_LABELS[(b.status as BoqStatus)] ?? b.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {b.projectId ? (
                      // z-10 lifts this link above the row's stretched anchor.
                      <Link
                        href={`/projects/${b.projectId}`}
                        className="relative z-10 text-brand-600 hover:underline dark:text-brand-500"
                      >
                        {b.projectName}
                      </Link>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{b.itemCount}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtMoney(b.totalCents, b.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
