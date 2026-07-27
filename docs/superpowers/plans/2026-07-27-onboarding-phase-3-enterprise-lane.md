# Onboarding Phase 3 — Enterprise / Government Request Lane

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give government and large-enterprise buyers a credible, procurement-friendly way onto DatumPro: a public `/enterprise` page with residency/procurement messaging and a request form that records the request and **emails DatumPro** to review. DatumPro then provisions the org manually with the existing create-org + invite flows.

**Architecture:** Additive, public. A new `enterprise_requests` table (RLS-locked; only the service role and a SECURITY DEFINER insert RPC touch it) captures leads. The public `/enterprise` page (root-level, outside `(app)`) posts to a server action that calls the RPC (matching the existing `invitation_preview` unauthenticated pattern) and sends a best-effort notification email. A guarded admin GET route lets DatumPro list requests via Mission Control for manual review.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (Postgres + RLS, SECURITY DEFINER RPC), Resend email, TailwindCSS v4. pnpm workspace.

**Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm dev`.

**Scope (locked with the user):** email-notify + **manual** provisioning. Therefore:
- **Deferred, NOT built:** `org.status` (pending/suspended) enum/column, suspension enforcement in middleware/app-shell, and any automated request→org provisioning or admin approval UI. None are needed when DatumPro provisions by hand, and org-status defaults would touch every existing org. Noted for a later phase.
- **In scope:** `enterprise_requests` table + insert RPC, the public `/enterprise` page + form + server action, the notification email + template + recipient env var, and a read-only admin list endpoint for review.

Phase 3 of `docs/superpowers/specs/2026-07-27-access-onboarding-design.md` §8. Phase 4 (SSO/domain) is separate.

---

## File Structure

**Create:**
- `supabase/migrations/20260101007200_enterprise_requests.sql` — table + `submit_enterprise_request` RPC.
- `apps/web/app/enterprise/page.tsx` — public request page (form + residency/procurement content).
- `apps/web/app/enterprise/actions.ts` — `submitEnterpriseRequest` server action.
- `apps/web/app/api/admin/enterprise-requests/route.ts` — adapter-guarded GET list.

**Modify:**
- `apps/web/lib/email/templates.ts` — add `enterpriseRequestEmail()`.
- `apps/web/.env.example` — document `ENTERPRISE_REQUEST_NOTIFY_EMAIL`.
- `apps/web/app/sign-in/page.tsx` — point "For government & enterprise" at `/enterprise`.

---

## Task 1: `enterprise_requests` table + insert RPC

**Files:**
- Create: `supabase/migrations/20260101007200_enterprise_requests.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — enterprise / government access requests
--
-- Public lead capture for the "for government & enterprise" lane. The table is
-- RLS-locked (no public/authenticated read or write); only the service role
-- (Mission Control admin API) reads it, and a SECURITY DEFINER RPC performs the
-- single allowed public write — an INSERT of a new request. DatumPro reviews and
-- provisions the org manually with the existing create-org + invite flows.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.enterprise_requests (
  id             uuid primary key default gen_random_uuid(),
  org_name       text not null,
  buyer_type     text,               -- government / enterprise / ngo / corporate / other
  country        text,
  contact_name   text,
  contact_email  text not null,
  team_size      text,
  needs          text,               -- freeform: SSO? residency? timelines?
  status         text not null default 'pending'
                   check (status in ('pending', 'reviewing', 'approved', 'rejected')),
  created_at     timestamptz not null default now(),
  reviewed_by    uuid references auth.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_org_id uuid references public.organizations(id) on delete set null
);
create index enterprise_requests_created_idx on public.enterprise_requests (created_at desc);

-- RLS on, NO policies: only the service role (RLS-bypassing) can read/write, and
-- the SECURITY DEFINER RPC below inserts. There is no public/anon read path.
alter table public.enterprise_requests enable row level security;

-- Public insert path for the unauthenticated request form. SECURITY DEFINER runs
-- as the function owner, bypassing RLS; it can ONLY insert a request (never read
-- existing ones). Mirrors the invitation_preview pattern.
create or replace function public.submit_enterprise_request(
  p_org_name      text,
  p_buyer_type    text,
  p_country       text,
  p_contact_name  text,
  p_contact_email text,
  p_team_size     text,
  p_needs         text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  req_id uuid;
begin
  if coalesce(trim(p_org_name), '') = '' then
    raise exception 'organisation name is required';
  end if;
  if coalesce(trim(p_contact_email), '') = '' or position('@' in p_contact_email) = 0 then
    raise exception 'a valid contact email is required';
  end if;

  insert into public.enterprise_requests
    (org_name, buyer_type, country, contact_name, contact_email, team_size, needs)
  values
    (trim(p_org_name), nullif(trim(p_buyer_type), ''), nullif(trim(p_country), ''),
     nullif(trim(p_contact_name), ''), trim(p_contact_email),
     nullif(trim(p_team_size), ''), nullif(trim(p_needs), ''))
  returning id into req_id;

  return req_id;
end;
$$;
```

- [ ] **Step 2: Apply**

Run: `pnpm db:reset` locally, or apply to the hosted DB via the Supabase tooling.
Expected: `enterprise_requests` table exists with RLS enabled and no policies; `submit_enterprise_request(...)` is callable.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101007200_enterprise_requests.sql
git commit -m "feat(enterprise): enterprise_requests table + public insert RPC"
```

---

## Task 2: Notification email template + recipient env

**Files:**
- Modify: `apps/web/lib/email/templates.ts` (add after `digestEmail`, before `export { appUrl };`)
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Add the template.** In `apps/web/lib/email/templates.ts`, insert before the final `export { appUrl };` line:

```typescript
export function enterpriseRequestEmail(opts: {
  orgName: string;
  buyerType?: string | null;
  country?: string | null;
  contactName?: string | null;
  contactEmail: string;
  teamSize?: string | null;
  needs?: string | null;
}) {
  const row = (label: string, value?: string | null) =>
    value ? `<p style="margin:0 0 4px"><strong>${label}:</strong> ${value}</p>` : '';
  return {
    subject: `Enterprise request: ${opts.orgName}`,
    html: layout({
      heading: 'New government / enterprise request',
      intro: `<strong>${opts.orgName}</strong> requested access via the enterprise lane.`,
      bodyHtml: `<div style="font-size:13px;color:#3f3f46;line-height:1.6;background:#f4f4f5;border-radius:8px;padding:12px">
        ${row('Contact', opts.contactName)}
        ${row('Email', opts.contactEmail)}
        ${row('Buyer type', opts.buyerType)}
        ${row('Country', opts.country)}
        ${row('Team size', opts.teamSize)}
        ${row('Needs', opts.needs)}
      </div>`,
      footnote: 'DatumPro enterprise request — review and provision the org manually.',
    }),
  };
}
```

- [ ] **Step 2: Document the recipient env var.** Append to `apps/web/.env.example`:

```bash
# Inbox that receives government/enterprise access requests from /enterprise.
# If unset, requests are still recorded — only the notification email is skipped.
ENTERPRISE_REQUEST_NOTIFY_EMAIL=
```

Note: this is server-only (read directly via `process.env` in the action, like `RESEND_API_KEY`), so it is NOT added to `lib/env.ts` (which validates client-exposed `NEXT_PUBLIC_*` vars).

- [ ] **Step 3: Type-check**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/email/templates.ts apps/web/.env.example
git commit -m "feat(enterprise): enterprise-request notification email template"
```

---

## Task 3: `/enterprise` server action

**Files:**
- Create: `apps/web/app/enterprise/actions.ts`

- [ ] **Step 1: Write the action**

```typescript
'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/resend';
import { enterpriseRequestEmail } from '@/lib/email/templates';

/** Public, unauthenticated request from /enterprise. The insert goes through a
 *  SECURITY DEFINER RPC (the only write the anon role may make to
 *  enterprise_requests); the notification email is best-effort. */
export async function submitEnterpriseRequest(formData: FormData) {
  const orgName = String(formData.get('orgName') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim();
  const buyerType = String(formData.get('buyerType') ?? '').trim();
  const country = String(formData.get('country') ?? '').trim();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const teamSize = String(formData.get('teamSize') ?? '').trim();
  const needs = String(formData.get('needs') ?? '').trim();

  if (!orgName || !contactEmail || !contactEmail.includes('@')) {
    redirect('/enterprise?error=' + encodeURIComponent('Please enter your organisation and a valid email.'));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_enterprise_request', {
    p_org_name: orgName,
    p_buyer_type: buyerType,
    p_country: country,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_team_size: teamSize,
    p_needs: needs,
  });
  if (error) {
    redirect('/enterprise?error=' + encodeURIComponent(error.message));
  }

  // Best-effort internal notification — never block the submitter on mail.
  try {
    const to = process.env.ENTERPRISE_REQUEST_NOTIFY_EMAIL;
    if (to) {
      const { subject, html } = enterpriseRequestEmail({
        orgName,
        buyerType,
        country,
        contactName,
        contactEmail,
        teamSize,
        needs,
      });
      await sendEmail({ to, subject, html, replyTo: contactEmail });
    } else {
      console.info('[enterprise] ENTERPRISE_REQUEST_NOTIFY_EMAIL unset — request recorded, notification skipped.');
    }
  } catch (e) {
    console.error('[enterprise] notification email failed (request still recorded):', e);
  }

  redirect('/enterprise?sent=1');
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/enterprise/actions.ts
git commit -m "feat(enterprise): submitEnterpriseRequest server action (RPC + notify)"
```

---

## Task 4: `/enterprise` public page

**Files:**
- Create: `apps/web/app/enterprise/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import Link from 'next/link';
import { submitEnterpriseRequest } from './actions';
import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';

export const metadata = { title: 'Government & Enterprise — DatumPro' };

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const assurances: { title: string; body: string }[] = [
  {
    title: 'Data isolation & access control',
    body: 'Every organisation is a separate tenant, enforced at the database with row-level security. Role separation keeps money actions, approvals, and delivery in the right hands.',
  },
  {
    title: 'Named accountability & audit',
    body: 'A named owner, a member roster, and a tamper-evident audit log of consequential actions — the trail procurement and auditors ask for.',
  },
  {
    title: 'Data residency & handling',
    body: 'Encryption in transit and at rest on managed cloud infrastructure. Tell us your residency and sovereignty requirements and we’ll confirm region and handling before you onboard.',
  },
  {
    title: 'Enterprise sign-in (on request)',
    body: 'MFA can be enforced org-wide today. SSO / SAML with your identity provider is available for enterprise and government deployments — mention it below.',
  },
];

export default async function EnterprisePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Government &amp; enterprise</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">DatumPro for larger organisations</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        For corporates, construction firms, NGOs, and government teams with procurement, identity, and
        data-handling requirements. Tell us what you need and we’ll set you up.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {assurances.map((a) => (
          <Card key={a.title}>
            <h2 className="text-sm font-semibold">{a.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{a.body}</p>
          </Card>
        ))}
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Request access</h2>
        {sent ? (
          <Card className="mt-3">
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
              Thanks — we’ve received your request and a member of the DatumPro team will be in touch shortly.
            </p>
            <Link href="/sign-in" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
              Back to sign in →
            </Link>
          </Card>
        ) : (
          <Card className="mt-3">
            {error && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
                {decodeURIComponent(error)}
              </p>
            )}
            <form action={submitEnterpriseRequest} className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Organisation</label>
                  <input name="orgName" required placeholder="e.g. Ministry of Public Works" className={inputClass} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Buyer type</label>
                  <select name="buyerType" defaultValue="" className={inputClass}>
                    <option value="">Select…</option>
                    <option value="government">Government</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="ngo">NGO</option>
                    <option value="corporate">Corporate</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Your name</label>
                  <input name="contactName" placeholder="Full name" className={inputClass} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Work email</label>
                  <input name="contactEmail" type="email" required placeholder="you@org.gov" className={inputClass} />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Country</label>
                  <input name="country" placeholder="e.g. Zimbabwe" className={inputClass} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Team size</label>
                  <input name="teamSize" placeholder="e.g. 50–200" className={inputClass} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  What do you need? <span className="text-zinc-400">(SSO, residency, timelines…)</span>
                </label>
                <textarea name="needs" rows={3} className={inputClass} />
              </div>
              <SubmitButton className="w-full" pendingText="Sending…">
                Request access
              </SubmitButton>
            </form>
          </Card>
        )}
      </div>

      <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
        Prefer to read about security first?{' '}
        <Link href="/security" className="underline">
          How we protect your data
        </Link>
        .
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Type-check, lint, smoke**

Run: `pnpm typecheck && pnpm lint`, then `pnpm dev` and visit `/enterprise` (no auth needed).
Expected: page renders the assurances + form; submitting redirects to `/enterprise?sent=1` and shows the thank-you; the request row appears in `enterprise_requests` (and a notification email sends if `ENTERPRISE_REQUEST_NOTIFY_EMAIL` + Resend are configured).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/enterprise/page.tsx
git commit -m "feat(enterprise): public /enterprise request page"
```

---

## Task 5: Admin list endpoint + wire the sign-in link

**Files:**
- Create: `apps/web/app/api/admin/enterprise-requests/route.ts`
- Modify: `apps/web/app/sign-in/page.tsx`

- [ ] **Step 1: Adapter-guarded GET list (for manual review via Mission Control)**

```typescript
import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** List enterprise/government access requests for manual review. Service-role:
 *  bypasses RLS, guarded by the adapter secret only. */
export async function GET(req: Request) {
  if (!adapterAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('enterprise_requests')
    .select('id, org_name, buyer_type, country, contact_name, contact_email, team_size, needs, status, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data ?? [] });
}
```

- [ ] **Step 2: Point the sign-in enterprise link at `/enterprise`.** In `apps/web/app/sign-in/page.tsx`, change the trust-footer link:

```tsx
          <a href="/enterprise" className="underline">
            For government &amp; enterprise
          </a>
```
(Previously `/security#residency`. The "How we protect your data" → `/security` link stays.)

- [ ] **Step 3: Type-check, lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/admin/enterprise-requests/route.ts apps/web/app/sign-in/page.tsx
git commit -m "feat(enterprise): admin list endpoint + sign-in link to /enterprise"
```

---

## Self-Review (against the spec §8 Phase 3)

- **Public request lane** → Tasks 3–4 (`/enterprise` page + action). ✅
- **`enterprise_requests` table + notification** → Task 1 (table + RPC), Task 2 (email + recipient env), Task 3 (send). ✅
- **Data-residency / procurement messaging** → Task 4 assurances (residency, isolation, audit, SSO-on-request) + link to `/security`. ✅
- **Manual provisioning** → Task 5 admin list endpoint for review; DatumPro then uses the existing create-org + invite flows. ✅
- **Deferred (documented):** `org.status` (pending/suspended), suspension enforcement, automated provisioning / approval UI — not needed for email-notify + manual, and org-status defaults would touch every existing org.

**Type consistency:** `submit_enterprise_request` RPC params (`p_org_name`, `p_buyer_type`, `p_country`, `p_contact_name`, `p_contact_email`, `p_team_size`, `p_needs`) match the `.rpc(...)` call in Task 3. `enterpriseRequestEmail(opts)` field names match the call site. The `/enterprise` form input `name`s (`orgName`, `buyerType`, `country`, `contactName`, `contactEmail`, `teamSize`, `needs`) match the action's `formData.get(...)` keys. No dangling references.
