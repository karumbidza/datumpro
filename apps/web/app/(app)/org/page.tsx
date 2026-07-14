import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import { getActiveContext } from '@/lib/data/org';
import { listOrgMembers, listPendingInvitations } from '@/lib/data/org-members';
import { renameOrganization } from './actions';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, DollarSign, FileText, ChevronRight } from '@/components/icons';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function OrgPage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active) redirect('/orgs/new');
  // Managing the organisation is an owner/admin concern.
  if (!can(ctx.active.role, 'member:manage')) redirect('/dashboard');

  const orgId = ctx.active.orgId;
  const canViewFinance = can(ctx.active.role, 'finance:view');
  // Reviewing contractor compliance docs is a staff (owner/admin/finance) concern.
  const canReviewDocs = can(ctx.active.role, 'payment:record');
  const [members, invitations] = await Promise.all([
    listOrgMembers(orgId),
    listPendingInvitations(orgId),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Organization</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Manage {ctx.active.name} — its details, the people in it, and its finances.
      </p>

      <section className="mt-6 space-y-4">
        {/* Settings */}
        <Card>
          <CardTitle>Details</CardTitle>
          <form action={renameOrganization} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="orgId" value={orgId} />
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-xs font-medium">Organisation name</label>
              <input name="name" required defaultValue={ctx.active.name} maxLength={120} className={inputClass} />
            </div>
            <Button type="submit">Save</Button>
          </form>
        </Card>

        {/* Team */}
        <Link href="/org/members" className="block">
          <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
            <div className="flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                <Users size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Members &amp; invitations</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {members.length} member{members.length === 1 ? '' : 's'}
                  {invitations.length > 0 && ` · ${invitations.length} pending invite${invitations.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-zinc-400" />
            </div>
          </Card>
        </Link>

        {/* Finance */}
        {canViewFinance && (
          <Link href="/finance" className="block">
            <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
              <div className="flex items-center gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                  <DollarSign size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Finance</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Budgets, invoices and payments across every project
                  </p>
                </div>
                <ChevronRight size={18} className="shrink-0 text-zinc-400" />
              </div>
            </Card>
          </Link>
        )}

        {/* Contractor compliance documents */}
        {canReviewDocs && (
          <Link href="/org/documents" className="block">
            <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
              <div className="flex items-center gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                  <FileText size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Contractor documents</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Tax clearances &amp; company documents to review
                  </p>
                </div>
                <ChevronRight size={18} className="shrink-0 text-zinc-400" />
              </div>
            </Card>
          </Link>
        )}
      </section>
    </main>
  );
}
