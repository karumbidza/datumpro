import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveContext } from '@/lib/data/org';
import { listOrgMembers, listPendingInvitations } from '@/lib/data/org-members';
import { inviteMember, revokeInvitation } from './actions';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ORG_ROLES } from '@datumpro/shared/access';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

// Roles an admin can hand out via invite (owner is reserved / transferred, not invited).
const INVITE_ROLES = ORG_ROLES.filter((r) => r !== 'owner');

export default async function OrgMembersPage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active) redirect('/orgs/new');

  const orgId = ctx.active.orgId;
  const isAdmin = ctx.active.role === 'owner' || ctx.active.role === 'admin';
  const [members, invitations] = await Promise.all([
    listOrgMembers(orgId),
    isAdmin ? listPendingInvitations(orgId) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{ctx.active.name} · Members</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Everyone in this organisation. Admins can invite new people by email and set their role.
      </p>

      {isAdmin && (
        <section className="mt-6">
          <Card>
            <CardTitle>Invite a teammate</CardTitle>
            <form action={inviteMember} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="orgId" value={orgId} />
              <div className="min-w-56 flex-1">
                <label className="mb-1 block text-xs font-medium">Email</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="name@company.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Role</label>
                <select name="role" defaultValue="member" className={inputClass}>
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Send invite</Button>
            </form>
          </Card>
        </section>
      )}

      {isAdmin && invitations.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Pending invitations
          </h2>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <Card key={inv.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-zinc-500">
                      invited as {inv.role} · {new Date(inv.createdAt).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <form action={revokeInvitation}>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <Button type="submit" variant="ghost">
                      Revoke
                    </Button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8 space-y-2">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Members ({members.length})
        </h2>
        {members.map((m) => (
          <Card key={m.userId}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {m.name}
                  {m.userId === ctx.userId && <span className="text-zinc-400"> · you</span>}
                </p>
                {m.email && <p className="truncate text-xs text-zinc-500">{m.email}</p>}
              </div>
              <Badge tone={m.role === 'owner' ? 'amber' : m.role === 'admin' ? 'blue' : 'neutral'}>
                {m.role}
              </Badge>
            </div>
          </Card>
        ))}
      </section>
    </main>
  );
}
