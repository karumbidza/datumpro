import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser, getActiveContext } from '@/lib/data/org';
import { getBoqDetail } from '@/lib/data/boq';
import { getTenderForOwner, getTenderComparison, getTenderOwnerExtras, listOrgProjects } from '@/lib/data/tender';
import { listOrgMembers } from '@/lib/data/org-members';
import { TENDER_STATUS_LABELS } from '@datumpro/shared/domain';
import { PageContainer } from '@/components/shell/page-container';
import { Badge } from '@/components/ui/badge';
import { TENDER_STATUS_TONE } from '@/components/ui/tones';
import { Button } from '@/components/ui/button';
import { BiddersPanel, type ContractorOption } from './bidders-panel';
import { CreateTenderForm } from './create-tender-form';
import { closeTender, unsealTender } from './actions';
import { Comparison } from './comparison';
import { StartDelivery } from './start-delivery';

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

  // Phase-2 data — only fetched when tender is in the relevant state.
  let unsealEligible = false;
  let comparison = null;
  let awardedProjectId: string | null = null;
  let awardedProjectName: string | null = null;
  let projects: { id: string; name: string }[] = [];

  if (tender !== null) {
    if (tender.unsealedAt === null && canManage) {
      // Sealed tender: check unseal eligibility.
      const extras = await getTenderOwnerExtras(tender.id);
      unsealEligible = extras.unsealEligible;
    } else if (tender.unsealedAt !== null) {
      // Unsealed tender: load comparison matrix, plus delivery-export data for staff.
      if (canManage) {
        const [cmp, extras, projs] = await Promise.all([
          getTenderComparison(ctx.active.orgId, boqId),
          getTenderOwnerExtras(tender.id),
          listOrgProjects(ctx.active.orgId),
        ]);
        comparison = cmp;
        awardedProjectId = extras.awardedProjectId;
        awardedProjectName = extras.awardedProjectName;
        projects = projs;
      } else {
        comparison = await getTenderComparison(ctx.active.orgId, boqId);
      }
    }
  }

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
              <Badge tone={TENDER_STATUS_TONE[tender.status] ?? 'neutral'}>
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
        ) : tender.unsealedAt === null ? (
          /* ── Tender sealed — unseal controls + bidder dashboard ── */
          <div className="space-y-6">
            {/* Unseal bids section — staff only */}
            {canManage && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
                <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Unseal bids
                </h2>
                <form action={unsealTender} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="tenderId" value={tender.id} />
                  <input type="hidden" name="boqId" value={boqId} />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={!unsealEligible}
                  >
                    Unseal bids
                  </Button>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Unseal unlocks once all invited bidders submit, or the deadline passes.
                  </p>
                </form>
              </div>
            )}

            {/* Bidder list */}
            <BiddersPanel
              tenderId={tender.id}
              boqId={boqId}
              bidders={tender.bidders}
              contractors={contractors}
              canManage={canManage}
            />
          </div>
        ) : (
          /* ── Tender unsealed — comparison matrix ── */
          comparison !== null ? (
            <div className="space-y-6">
              <Comparison data={comparison} boqId={boqId} canManage={canManage} />

              {/* Delivery export — staff only, once the tender is awarded */}
              {canManage && tender.status === 'awarded' && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
                  <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Delivery</h2>
                  {awardedProjectId ? (
                    <Link
                      href={`/projects/${awardedProjectId}/tasks`}
                      className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-500"
                    >
                      View delivery project{awardedProjectName ? `: ${awardedProjectName}` : ''} →
                    </Link>
                  ) : (
                    <StartDelivery tenderId={tender.id} boqId={boqId} projects={projects} />
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Comparison data is not available yet.
            </p>
          )
        )}
      </div>
    </PageContainer>
  );
}
