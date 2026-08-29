import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { INVITABLE_MEMBER_TYPES, MEMBER_TYPE_META } from '@datumpro/shared/access';
import { inviteMember, revokeInvitation, resendInvitation } from '@/app/(app)/org/members/actions';
import { MembersRoster } from '@/components/org/members-roster';
import { inputCompactClass as inputClass, Req } from '@/components/ui/form';
import type { ContractorDocRow } from '@/lib/data/contractor-documents';
import type { OrgInvitationRow } from '@/lib/data/org-members';

type Member = Parameters<typeof MembersRoster>[0]['members'][number];

export function MembersPanel({
  orgId, meId, members, invitations, projects, docsByContractor, canReviewDocs,
}: {
  orgId: string;
  meId: string;
  members: Member[];
  invitations: OrgInvitationRow[];
  projects: { id: string; name: string }[];
  docsByContractor: Map<string, ContractorDocRow[]>;
  canReviewDocs: boolean;
}) {
  return (
    <div className="space-y-8">
      <Card>
        <CardTitle>Invite someone</CardTitle>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Their organisation role sets company-wide access. Contractors are usually invited as{' '}
          <span className="font-medium">member</span> — you give them the Contractor role when you assign
          them to a project.
        </p>
        <form action={inviteMember} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="orgId" value={orgId} />
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-xs font-medium">Email<Req /></label>
            <input type="email" name="email" required placeholder="name@company.com" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Member type</label>
            <select name="memberType" defaultValue="staff" className={inputClass}>
              {INVITABLE_MEMBER_TYPES.map((t) => (
                <option key={t} value={t}>{MEMBER_TYPE_META[t].label}</option>
              ))}
            </select>
          </div>
          <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
        </form>
      </Card>

      {invitations.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Pending invitations</h2>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <Card key={inv.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      invited as {MEMBER_TYPE_META[inv.memberType].label} · {new Date(inv.createdAt).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <form action={resendInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <SubmitButton variant="secondary" pendingText="Sending…">Resend</SubmitButton>
                    </form>
                    <form action={revokeInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <SubmitButton variant="ghost" pendingText="…">Revoke</SubmitButton>
                    </form>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Members ({members.length})</h2>
        <MembersRoster
          orgId={orgId} members={members} projects={projects} meId={meId} isAdmin
          docsByContractor={docsByContractor} canReviewDocs={canReviewDocs}
        />
      </section>
    </div>
  );
}
