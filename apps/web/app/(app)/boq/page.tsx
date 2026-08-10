import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { listBoqs } from '@/lib/data/boq';
import { listMyTenderInvites } from '@/lib/data/tender';
import { ContractorTenderPortal } from './contractor-portal';
import { PageContainer } from '@/components/shell/page-container';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText } from '@/components/icons';
import { BOQ_STATUS_LABELS, type BoqStatus } from '@datumpro/shared/domain';
import { fmtMoney } from '@/lib/money';

const STATUS_TONE: Record<BoqStatus, BadgeTone> = { draft: 'amber', approved: 'green', archived: 'faint' };

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

  const boqs = await listBoqs(ctx.active.orgId);
  const canEdit = ['owner', 'admin', 'pm'].includes(ctx.active.role);

  return (
    <PageContainer width="5xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bills of Quantities</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Bills of quantities for{' '}
            <span className="font-medium text-brand-600 dark:text-brand-500">{ctx.active.name}</span>.
          </p>
        </div>
        {canEdit && (
          <Link href="/boq/new">
            <Button>New BOQ</Button>
          </Link>
        )}
      </div>

      {boqs.length === 0 ? (
        <div className="mt-8 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <EmptyState
            icon={FileText}
            title="No bills yet"
            hint="A BOQ is an estimate you build once and reuse — sections of priced items, ready to put to tender."
            action={
              canEdit ? (
                <Link href="/boq/new">
                  <Button size="sm">Start a new BOQ</Button>
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2.5 font-semibold">Bill</th>
                <th className="px-4 py-2.5 font-semibold">Industry</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Items</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
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
                    <Badge tone={STATUS_TONE[(b.status as BoqStatus)] ?? 'neutral'}>
                      {BOQ_STATUS_LABELS[(b.status as BoqStatus)] ?? b.status}
                    </Badge>
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
