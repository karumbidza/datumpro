import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveContext } from '@/lib/data/org';
import { listProjects } from '@/lib/data/projects';
import { listOrgMembers, listPendingInvitations } from '@/lib/data/org-members';
import { inviteMember, revokeInvitation, resendInvitation } from './actions';
import { MembersRoster } from '@/components/org/members-roster';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { INVITABLE_MEMBER_TYPES, MEMBER_TYPE_META } from '@datumpro/shared/access';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function OrgMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invited?: string; resent?: string; assigned?: string }>;
}) {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active) redirect('/orgs/new');

  const sp = await searchParams;
  const notice = sp.error
    ? { kind: 'error' as const, text: sp.error }
    : sp.invited
      ? { kind: 'ok' as const, text: 'Invitation sent.' }
      : sp.resent
        ? { kind: 'ok' as const, text: 'Invitation re-sent.' }
        : sp.assigned
          ? { kind: 'ok' as const, text: 'Member assigned to the project.' }
          : null;

  const orgId = ctx.active.orgId;
  const isAdmin = ctx.active.role === 'owner' || ctx.active.role === 'admin';
  // Members management is admin-only — match /org. Non-admins can't view the
  // roster here (RLS already blocks the mutations; this closes the disclosure).
  if (!isAdmin) redirect('/dashboard');
  const [members, invitations, projectRows] = await Promise.all([
    listOrgMembers(orgId),
    isAdmin ? listPendingInvitations(orgId) : Promise.resolve([]),
    // Projects only feed the optional "assign to a project" dropdown — a
    // transient projects/RLS error must never take down the whole Members page
    // (e.g. on the re-render triggered after a successful invite).
    isAdmin ? listProjects().catch(() => []) : Promise.resolve([]),
  ]);
  const projects = projectRows.map((p) => ({ id: p.id, name: p.name }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/org" className="text-xs text-zinc-500 hover:underline">
        ← Organization
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{ctx.active.name} · Members</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Add everyone — staff and contractors — to your organisation once, here. Then assign them to the
        projects they work on (with a project role like Contractor or PM).
      </p>

      {notice && (
        <p
          className={`mt-4 rounded-md px-3 py-2 text-sm ${
            notice.kind === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
              : 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
          }`}
        >
          {notice.text}
        </p>
      )}

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
                <label className="mb-1 block text-xs font-medium">Member type</label>
                <select name="memberType" defaultValue="staff" className={inputClass}>
                  {INVITABLE_MEMBER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {MEMBER_TYPE_META[t].label}
                    </option>
                  ))}
                </select>
              </div>
              <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
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
                      invited as {MEMBER_TYPE_META[inv.memberType].label} · {new Date(inv.createdAt).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <form action={resendInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <SubmitButton variant="secondary" pendingText="Sending…">
                        Resend
                      </SubmitButton>
                    </form>
                    <form action={revokeInvitation}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <SubmitButton variant="ghost" pendingText="…">
                        Revoke
                      </SubmitButton>
                    </form>
                  </div>
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
