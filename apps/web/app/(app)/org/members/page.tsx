import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveContext } from '@/lib/data/org';
import { listProjects } from '@/lib/data/projects';
import { listOrgMembers, listPendingInvitations } from '@/lib/data/org-members';
import { inviteMember, revokeInvitation } from './actions';
import { MembersRoster } from '@/components/org/members-roster';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ORG_ROLES } from '@datumpro/shared/access';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const INVITE_ROLES = ORG_ROLES.filter((r) => r !== 'owner');

export default async function OrgMembersPage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active) redirect('/orgs/new');

  const orgId = ctx.active.orgId;
  const isAdmin = ctx.active.role === 'owner' || ctx.active.role === 'admin';
  const [members, invitations, projectRows] = await Promise.all([
    listOrgMembers(orgId),
    isAdmin ? listPendingInvitations(orgId) : Promise.resolve([]),
    isAdmin ? listProjects() : Promise.resolve([]),
  ]);
  const projects = projectRows.map((p) => ({ id: p.id, name: p.name }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{ctx.active.name} · Members</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Add everyone — staff and contractors — to your organisation once, here. Then assign them to the
        projects they work on (with a project role like Contractor or PM).
      </p>

      {isAdmin && (
        <section className="mt-6">
          <Card>
            <CardTitle>Invite someone</CardTitle>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Their organisation role sets company-wide access. Contractors are usually invited as{' '}
              <span className="font-medium">member</span> — you give them the Contractor role when you
              assign them to a project.
            </p>
            <form action={inviteMember} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="orgId" value={orgId} />
              <div className="min-w-56 flex-1">
                <label className="mb-1 block text-xs font-medium">Email</label>
                <input type="email" name="email" required placeholder="name@company.com" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Org role</label>
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
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Pending invitations</h2>
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

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Members ({members.length})
        </h2>
        <MembersRoster orgId={orgId} members={members} projects={projects} meId={ctx.userId} isAdmin={isAdmin} />
      </section>
    </main>
  );
}
