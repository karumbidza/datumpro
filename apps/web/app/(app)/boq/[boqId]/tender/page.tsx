import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser, getActiveContext } from '@/lib/data/org';
import { getBoqDetail } from '@/lib/data/boq';
import { getTenderForOwner } from '@/lib/data/tender';
import { listOrgMembers } from '@/lib/data/org-members';
import { TENDER_STATUS_LABELS, type TenderStatus } from '@datumpro/shared/domain';
import { PageContainer } from '@/components/shell/page-container';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BiddersPanel, type ContractorOption } from './bidders-panel';
import { CreateTenderForm } from './create-tender-form';
import { closeTender } from './actions';

const STATUS_TONE: Record<TenderStatus, BadgeTone> = {
  draft: 'faint',
  open: 'blue',
  closed: 'amber',
  awarded: 'green',
  cancelled: 'red',
};

export default async function TenderPage({
  params,
}: {
  params: Promise<{ boqId: string }>;
}) {
  const { boqId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');

  const canManage = ['owner', 'admin', 'pm'].includes(ctx.active.role);

  const [boq, tender, allMembers] = await Promise.all([
    getBoqDetail(ctx.active.orgId, boqId),
    getTenderForOwner(ctx.active.orgId, boqId),
    canManage ? listOrgMembers(ctx.active.orgId) : Promise.resolve([]),
  ]);

  // Contractor members only — used to pre-fill the invite picker.
  const contractors: ContractorOption[] = allMembers
    .filter((m) => m.memberType === 'contractor' && m.status === 'active' && m.email)
    .map((m) => ({ id: m.userId, name: m.name, email: m.email! }));

  return (
    <PageContainer width="4xl">
      {/* Back link */}
      <Link href={`/boq/${boqId}`} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
        ← BOQ{boq ? ` — ${boq.name}` : ''}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Tender</h1>
          {tender && (
            <>
              <span className="text-zinc-400">·</span>
              <span className="text-lg font-medium text-zinc-700 dark:text-zinc-300">{tender.title}</span>
              <Badge tone={STATUS_TONE[tender.status] ?? 'neutral'}>
                {TENDER_STATUS_LABELS[tender.status] ?? tender.status}
              </Badge>
            </>
          )}
        </div>

        {/* Close tender — only when open and user can manage */}
        {canManage && tender && tender.status === 'open' && (
          <form action={closeTender}>
            <input type="hidden" name="tenderId" value={tender.id} />
            <input type="hidden" name="boqId" value={boqId} />
            <Button type="submit" variant="secondary" size="sm">
              Close tender
            </Button>
          </form>
        )}
      </div>

      {tender?.closeAt && (
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Closing{' '}
          {new Date(tender.closeAt).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}

      <div className="mt-6">
        {tender === null ? (
          /* ── No tender yet ── */
          canManage ? (
            <div className="mx-auto max-w-lg">
              <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
                Put this BOQ out to sealed tender — contractors will bid without seeing each other&apos;s prices.
              </p>
              <CreateTenderForm boqId={boqId} defaultTitle={boq?.name ?? ''} />
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              No tender has been created for this BOQ yet.
            </p>
          )
        ) : (
          /* ── Tender exists — show bidder dashboard ── */
          <BiddersPanel
            tenderId={tender.id}
            boqId={boqId}
            bidders={tender.bidders}
            contractors={contractors}
            canManage={canManage}
          />
        )}
      </div>
    </PageContainer>
  );
}
