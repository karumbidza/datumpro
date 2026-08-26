import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { theadRowClass, thClass } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText } from '@/components/icons';
import type { MyTenderInvite } from '@/lib/data/tender';

function fmtDate(iso: string | null): string {
  if (!iso) return 'No deadline';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ContractorTenderPortal({ invites, orgName }: { invites: MyTenderInvite[]; orgName: string }) {
  return (
    <PageContainer width="5xl">
      <PageHeader
        title="Tenders"
        subtitle={
          <>
            Tenders you&apos;ve been invited to price for{' '}
            <span className="font-medium text-brand-600 dark:text-brand-500">{orgName}</span>.
          </>
        }
      />

      {invites.length === 0 ? (
        <div className="mt-8 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <EmptyState
            icon={FileText}
            title="No tenders yet"
            hint="When a client invites you to price a bill of quantities, it will appear here."
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={theadRowClass}>
                <th className={thClass}>Tender</th>
                <th className={thClass}>Closes</th>
                <th className={thClass}>Status</th>
                <th className={`${thClass} text-right`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const canPrice =
                  !inv.tenderAwarded && (inv.bidderStatus === 'invited' || inv.bidderStatus === 'viewing');
                const statusBadge = inv.awardedToMe ? (
                  <Badge tone="green">Awarded ✓</Badge>
                ) : inv.tenderAwarded ? (
                  <Badge tone="faint">Closed</Badge>
                ) : inv.bidderStatus === 'submitted' ? (
                  <Badge tone="blue">Submitted</Badge>
                ) : (
                  <Badge tone="amber">To price</Badge>
                );
                return (
                  <tr key={inv.bidderId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-2.5 font-medium text-zinc-800 dark:text-zinc-200">{inv.title}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{fmtDate(inv.closeAt)}</td>
                    <td className="px-4 py-2.5">{statusBadge}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/tender/${inv.inviteToken}`}>
                        <Button variant="secondary" size="sm">
                          {canPrice ? 'Price →' : 'View →'}
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
