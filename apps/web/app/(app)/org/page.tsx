import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import { getActiveContext } from '@/lib/data/org';
import { listOrgMembers, listPendingInvitations } from '@/lib/data/org-members';
import { getOrgSecondApprover } from '@/lib/data/approvals';
import { renameOrganization, setApprovalPolicy, updateCompanyProfile, uploadOrgLogo, removeOrgLogo } from './actions';
import { setOrgMfaRequirement } from './mfa-actions';
import { addOrgDomain, verifyOrgDomain, removeOrgDomain } from './domain-actions';
import { createClient } from '@/lib/supabase/server';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { ChevronRight, ShieldAlert } from '@/components/icons';
import { inputClass } from '@/components/ui/form';
import { MembersPanel } from '@/components/org/members-panel';
import { listOrgContractorDocuments } from '@/lib/data/contractor-documents';
import { listProjects } from '@/lib/data/projects';

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'security', label: 'Security' },
  { key: 'policies', label: 'Policies' },
  { key: 'domains', label: 'Domains' },
  { key: 'members', label: 'Members' },
  { key: 'integrations', label: 'Integrations' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; derror?: string; dok?: string }>;
}) {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active) redirect('/orgs/new');
  // Managing the organisation is an owner/admin concern.
  if (!can(ctx.active.role, 'member:manage')) redirect('/dashboard');

  const orgId = ctx.active.orgId;
  const { tab, derror, dok } = await searchParams;
  const activeTab: TabKey = (TABS.some((t) => t.key === tab) ? tab : 'general') as TabKey;
  // Reviewing contractor compliance docs is a staff (owner/admin/finance) concern.
  const canReviewDocs = can(ctx.active.role, 'payment:record');

  const supabase = await createClient();
  const [members, invitations, secondApprover, { data: orgRow }, { data: domains }, projectRows, docsByContractor] =
    await Promise.all([
      listOrgMembers(orgId),
      listPendingInvitations(orgId),
      getOrgSecondApprover(orgId),
      supabase
        .from('organizations')
        .select('require_mfa, legal_name, sector, country, registration_number')
        .eq('id', orgId)
        .single(),
      supabase
        .from('org_domains')
        .select('id, domain, verified_at, verification_token')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true }),
      listProjects().catch(() => []),
      listOrgContractorDocuments(orgId),
    ]);
  const projects = projectRows.map((p) => ({ id: p.id, name: p.name }));
  const org = (orgRow ?? {}) as {
    require_mfa?: boolean;
    legal_name?: string | null;
    sector?: string | null;
    country?: string | null;
    registration_number?: string | null;
  };
  const requireMfa = org.require_mfa ?? false;
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
        title="Organization settings"
        subtitle={<>Manage {ctx.active.name} — its profile, security, policies and domains.</>}
      />

      {/* Tab bar (URL-driven, deep-linkable) */}
      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => {
          const on = t.key === activeTab;
          return (
            <Link
              key={t.key}
              href={`/org?tab=${t.key}`}
              aria-current={on ? 'page' : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors ${
                on
                  ? 'border-brand-600 font-medium text-brand-700 dark:border-brand-500 dark:text-brand-400'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <section className="mt-6 space-y-4">
        {activeTab === 'general' && (
          <>
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

            <Card>
              <CardTitle>Logo</CardTitle>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Shown in the organisation switcher. PNG, JPEG or WebP up to 2 MB — a square image works best.
              </p>
              <div className="mt-3 flex items-center gap-4">
                <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  {ctx.active.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ctx.active.logoUrl} alt="" className="size-full object-contain" />
                  ) : (
                    <span className="text-lg font-semibold text-zinc-400 dark:text-zinc-600">
                      {ctx.active.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <div className="flex flex-col gap-2">
                  <form action={uploadOrgLogo} className="flex items-center gap-2">
                    <input type="hidden" name="orgId" value={orgId} />
                    <input
                      type="file"
                      name="logo"
                      accept="image/png,image/jpeg,image/webp"
                      required
                      className="block max-w-[13rem] text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:text-zinc-400 dark:file:bg-zinc-800 dark:file:text-zinc-200"
                    />
                    <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
                  </form>
                  {ctx.active.logoUrl && (
                    <form action={removeOrgLogo}>
                      <input type="hidden" name="orgId" value={orgId} />
                      <button
                        type="submit"
                        className="text-xs text-zinc-500 underline hover:text-red-600 dark:text-zinc-400"
                      >
                        Remove logo
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <CardTitle>Company profile</CardTitle>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Captured when the organisation was created — edit it here. Used on documents and for compliance.
              </p>
              <form action={updateCompanyProfile} className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="orgId" value={orgId} />
                <Field label="Legal name" name="legalName" defaultValue={org.legal_name ?? ''} placeholder="Acme Construction (Pvt) Ltd" />
                <Field label="Sector / industry" name="sector" defaultValue={org.sector ?? ''} placeholder="Civil engineering" />
                <Field label="Country" name="country" defaultValue={org.country ?? ''} placeholder="Zimbabwe" />
                <Field label="Registration number" name="registrationNumber" defaultValue={org.registration_number ?? ''} placeholder="CR-123456" />
                <div className="sm:col-span-2">
                  <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
                </div>
              </form>
            </Card>
          </>
        )}

        {activeTab === 'security' && (
          <>
            <Card>
              <CardTitle>Two-factor authentication</CardTitle>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Require every member of this organisation to sign in with 2FA. They&apos;ll be prompted to set up an
                authenticator app the next time they open the app.
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

            <ComingSoon
              title="Single sign-on (SSO)"
              body="Let members sign in with your identity provider (SAML / OIDC) — Okta, Google Workspace, Microsoft Entra. Available on the enterprise plan."
            />
          </>
        )}

        {activeTab === 'policies' && (
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
        )}

        {activeTab === 'domains' && (
          <Card>
            <CardTitle>Verified domains</CardTitle>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Verify a domain you own (e.g. acme.com) so teammates who sign up with that email address can join this
              organisation directly instead of creating a duplicate.
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
                          <button
                            type="submit"
                            className="text-sm text-zinc-500 underline hover:text-red-600 dark:text-zinc-400"
                          >
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
        )}

        {activeTab === 'members' && (
          <>
            <Link href="/org/audit" className="block">
              <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                <div className="flex items-center gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                    <ShieldAlert size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Audit log</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Who did what — a read-only record of consequential actions</p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
                </div>
              </Card>
            </Link>
            <MembersPanel
              orgId={orgId} meId={ctx.userId} members={members} invitations={invitations}
              projects={projects} docsByContractor={docsByContractor} canReviewDocs={canReviewDocs}
            />
          </>
        )}

        {activeTab === 'integrations' && (
          <ComingSoon
            title="Integrations"
            body="Connect DatumPro to the tools you already use — accounting (Xero, QuickBooks), cloud storage and webhooks. Coming soon."
          />
        )}
      </section>
    </PageContainer>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} className={inputClass} />
    </div>
  );
}

function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <CardTitle>{title}</CardTitle>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          Coming soon
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{body}</p>
    </Card>
  );
}

