import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import { getActiveContext } from '@/lib/data/org';
import { listOrgMembers, listPendingInvitations } from '@/lib/data/org-members';
import { getOrgSecondApprover } from '@/lib/data/approvals';
import { renameOrganization, setApprovalPolicy } from './actions';
import { setOrgMfaRequirement } from './mfa-actions';
import { addOrgDomain, verifyOrgDomain, removeOrgDomain } from './domain-actions';
import { createClient } from '@/lib/supabase/server';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { Users, DollarSign, FileText, ChevronRight, ShieldAlert } from '@/components/icons';

import { inputClass } from '@/components/ui/form';

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ derror?: string; dok?: string }>;
}) {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active) redirect('/orgs/new');
  // Managing the organisation is an owner/admin concern.
  if (!can(ctx.active.role, 'member:manage')) redirect('/dashboard');

  const orgId = ctx.active.orgId;
  const { derror, dok } = await searchParams;
  const canViewFinance = can(ctx.active.role, 'finance:view');
  // Reviewing contractor compliance docs is a staff (owner/admin/finance) concern.
  const canReviewDocs = can(ctx.active.role, 'payment:record');
  const supabase = await createClient();
  const [members, invitations, secondApprover, { data: orgRow }, { data: domains }] = await Promise.all([
    listOrgMembers(orgId),
    listPendingInvitations(orgId),
    getOrgSecondApprover(orgId),
    supabase.from('organizations').select('require_mfa').eq('id', orgId).single(),
    supabase
      .from('org_domains')
      .select('id, domain, verified_at, verification_token')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
  ]);
  const requireMfa = (orgRow as { require_mfa?: boolean } | null)?.require_mfa ?? false;
  const domainRows = (domains ?? []) as {
    id: string;
    domain: string;
    verified_at: string | null;
    verification_token: string;
  }[];

  return (
    <PageContainer width="3xl">
      <PageHeader
        backHref="/dashboard"
        backLabel="Dashboard"
        title="Organization"
        subtitle={<>Manage {ctx.active.name} — its details, the people in it, and its finances.</>}
      />

      <section className="mt-8 space-y-4">
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

        {/* Approval policy */}
        <Card>
          <CardTitle>Approval policy</CardTitle>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Everything that needs sign-off (task plans, variations, extensions, payments, requests) goes to the{' '}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">project manager first</span>, then to a second
            approver — set that here, or make it a single PM-only approval.
          </p>
          <form action={setApprovalPolicy} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="orgId" value={orgId} />
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-xs font-medium">Second approver</label>
              <select name="secondApprover" defaultValue={secondApprover} className={inputClass}>
                <option value="admin">Admin (default)</option>
                <option value="finance">Finance</option>
                <option value="viewer">Viewer</option>
                <option value="pm">Another PM</option>
                <option value="none">None — PM approves alone</option>
              </select>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </Card>

        {/* Security — org-enforced 2FA */}
        <Card>
          <CardTitle>Security</CardTitle>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Require every member of this organisation to sign in with two-factor authentication. They&apos;ll be
            prompted to set up an authenticator app the next time they open the app.
          </p>
          <form action={setOrgMfaRequirement} className="mt-3 flex items-center gap-3">
            <input type="hidden" name="orgId" value={orgId} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="requireMfa" defaultChecked={requireMfa} />
              Require two-factor authentication (2FA)
            </label>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </form>
        </Card>

        {/* Verified domains */}
        <Card>
          <CardTitle>Verified domains</CardTitle>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Verify a domain you own (e.g. acme.com) so teammates who sign up with that email address can join
            this organisation directly instead of creating a duplicate.
          </p>

          {derror && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
              {decodeURIComponent(derror)}
            </p>
          )}
          {dok && (
            <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-400">
              Domain verified. Teammates on that domain can now join.
            </p>
          )}

          {domainRows.length > 0 && (
            <ul className="mt-3 space-y-3">
              {domainRows.map((d) => (
                <li key={d.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.domain}</span>
                    {d.verified_at ? (
                      <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-500/10 dark:text-green-400">
                        Verified
                      </span>
                    ) : (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                        Pending
                      </span>
                    )}
                    <span className="ml-auto flex gap-2">
                      {!d.verified_at && (
                        <form action={verifyOrgDomain}>
                          <input type="hidden" name="orgId" value={orgId} />
                          <input type="hidden" name="id" value={d.id} />
                          <SubmitButton pendingText="Checking…">Verify</SubmitButton>
                        </form>
                      )}
                      <form action={removeOrgDomain}>
                        <input type="hidden" name="orgId" value={orgId} />
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className="text-sm text-zinc-500 dark:text-zinc-400 underline hover:text-red-600">
                          Remove
                        </button>
                      </form>
                    </span>
                  </div>
                  {!d.verified_at && (
                    <p className="mt-2 break-all text-xs text-zinc-500 dark:text-zinc-400">
                      Add a DNS <span className="font-medium">TXT</span> record on{' '}
                      <span className="font-medium">{d.domain}</span> with value:{' '}
                      <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">{d.verification_token}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form action={addOrgDomain} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="orgId" value={orgId} />
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-xs font-medium">Add a domain</label>
              <input name="domain" required placeholder="acme.com" className={inputClass} />
            </div>
            <SubmitButton pendingText="Adding…">Add domain</SubmitButton>
          </form>
        </Card>

        {/* Audit log */}
        <Link href="/org/audit" className="block">
          <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
            <div className="flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                <ShieldAlert size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Audit log</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Who did what — a read-only record of consequential actions
                </p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
            </div>
          </Card>
        </Link>

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
              <ChevronRight size={18} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
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
                <ChevronRight size={18} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
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
                <ChevronRight size={18} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
              </div>
            </Card>
          </Link>
        )}
      </section>
    </PageContainer>
  );
}
