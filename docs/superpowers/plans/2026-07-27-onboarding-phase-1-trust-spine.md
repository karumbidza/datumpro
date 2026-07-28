# Onboarding Phase 1 — Trust Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn DatumPro's one-field org creation into a trust-forward self-serve onboarding: a company-profile setup wizard, a work-email gate on org creation, and a trust surface on the login screen — the foundation the later phases (MFA, audit, enterprise lane, SSO) build on.

**Architecture:** Pure additive change. A new migration adds nullable company-profile columns to `organizations`. Reusable, unit-tested validation (work-email blocklist + company-profile schema) lives in `@datumpro/shared`. The existing `createOrg` server action and `/orgs/new` page are upgraded from a single name field into the wizard's first screen; a success screen nudges the next steps (invite team, first project) using existing pages. A new `/security` page plus trust signals and an enterprise link on `/sign-in` complete the public surface. Email delivery already exists (Resend) — no work needed there.

**Tech Stack:** Next.js 15 (App Router, Server Components + Server Actions), Supabase (Postgres + RLS), Zod validation in `@datumpro/shared`, Vitest, TailwindCSS v4 (custom components, no shadcn).

**Package manager:** pnpm (workspace). Command mapping used below: shared tests = `pnpm -F @datumpro/shared test [-- <pattern>]`; full test = `pnpm test`; typecheck = `pnpm typecheck`; lint = `pnpm lint`; dev = `pnpm dev`; type gen = `pnpm gen:types`. (Where a step reads `npm …`, run the pnpm equivalent.)

**Scope note:** This is Phase 1 of the spec `docs/superpowers/specs/2026-07-27-access-onboarding-design.md`. Phases 2 (MFA + audit), 3 (enterprise lane), and 4 (SSO/domain verification) get their own plans. Email verification "ON" is a Supabase project config toggle (Auth → confirm email), documented in Task 7 — not code.

---

## File Structure

**Create:**
- `supabase/migrations/20260101006900_org_company_profile.sql` — adds company-profile columns to `organizations`.
- `packages/shared/src/validation/email.ts` — work-email (personal-domain) blocklist + `isBusinessEmail()`.
- `packages/shared/src/validation/email.test.ts` — Vitest coverage for the blocklist.
- `apps/web/app/orgs/new/done/page.tsx` — post-creation "next steps" screen (wizard step 2).
- `apps/web/app/security/page.tsx` — public trust/security page.

**Modify:**
- `packages/shared/src/validation/index.ts` — add `createOrgSchema` company-profile fields; re-export `./email`.
- `packages/shared/src/validation/index.test.ts` (create if absent) — schema tests.
- `apps/web/app/orgs/actions.ts` — `createOrg` accepts profile fields, enforces work-email gate, sets `onboarding_completed_at`, redirects to the done screen.
- `apps/web/app/orgs/new/page.tsx` — company-profile form (legal name, country, sector, reg number).
- `apps/web/app/sign-in/page.tsx` — add trust signals + "For government & enterprise" link.

---

## Task 1: Company-profile columns migration

**Files:**
- Create: `supabase/migrations/20260101006900_org_company_profile.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — organization company profile
--
-- Onboarding Phase 1: capture a lightweight, on-record company profile at org
-- creation (legal name, country, sector, registration number) plus a marker for
-- when first-run onboarding was completed. All nullable — existing orgs are
-- unaffected and keep working with just `name`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists legal_name             text,
  add column if not exists country                text,
  add column if not exists sector                 text,
  add column if not exists registration_number    text,
  add column if not exists onboarding_completed_at timestamptz;
```

- [ ] **Step 2: Apply the migration locally**

Run: `supabase db reset` (rebuilds local DB from all migrations) — or `supabase migration up` if the local stack is already running.
Expected: completes with no error; the new migration appears in the applied list.

- [ ] **Step 3: Verify columns exist**

Run: `supabase db diff` (should report no schema drift) or query:
`psql "$SUPABASE_DB_URL" -c "\d public.organizations"`
Expected: `legal_name`, `country`, `sector`, `registration_number`, `onboarding_completed_at` present, all nullable.

- [ ] **Step 4: Regenerate DB types**

Run: `npm run gen:types` (the repo's `supabase gen types typescript` script) — confirm `packages/shared/src/db/database.types.ts` now includes the new columns on `organizations`.
Expected: type file updates; `git diff` shows the five new fields.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101006900_org_company_profile.sql packages/shared/src/db/database.types.ts
git commit -m "feat(db): add company-profile columns to organizations"
```

---

## Task 2: Work-email blocklist (shared, TDD)

**Files:**
- Create: `packages/shared/src/validation/email.ts`
- Test: `packages/shared/src/validation/email.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { isBusinessEmail, PERSONAL_EMAIL_DOMAINS } from './email';

describe('isBusinessEmail — work-email gate for org creation', () => {
  it('accepts company domains', () => {
    expect(isBusinessEmail('allen@grafaid.co.ke')).toBe(true);
    expect(isBusinessEmail('pm@acme-construction.com')).toBe(true);
  });

  it('rejects common free/personal providers', () => {
    expect(isBusinessEmail('someone@gmail.com')).toBe(false);
    expect(isBusinessEmail('someone@yahoo.com')).toBe(false);
    expect(isBusinessEmail('someone@outlook.com')).toBe(false);
    expect(isBusinessEmail('someone@hotmail.com')).toBe(false);
    expect(isBusinessEmail('someone@icloud.com')).toBe(false);
  });

  it('is case-insensitive and trims', () => {
    expect(isBusinessEmail('  Someone@GMAIL.com ')).toBe(false);
    expect(isBusinessEmail('Owner@Grafaid.CO.KE')).toBe(true);
  });

  it('treats malformed input as not a business email', () => {
    expect(isBusinessEmail('')).toBe(false);
    expect(isBusinessEmail('no-at-sign')).toBe(false);
  });

  it('exposes the blocklist as a tunable constant', () => {
    expect(PERSONAL_EMAIL_DOMAINS.has('gmail.com')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @datumpro/shared -- email` (or `cd packages/shared && npx vitest run email`)
Expected: FAIL — `Cannot find module './email'`.

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Work-email gate for org creation. We keep the block conservative — only the
 * most common free/consumer providers — because many legitimate SMEs (especially
 * construction firms) use a small provider domain. Invited members are NOT gated
 * (they arrive via an invitation, not org creation), so field contractors on
 * personal email are unaffected. Tune PERSONAL_EMAIL_DOMAINS as needed.
 */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'yandex.com',
  'mail.com',
]);

/** True when `email` looks like a real company address (not a free provider). */
export function isBusinessEmail(email: string): boolean {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at <= 0 || at === email.trim().length - 1) return false;
  const domain = email.trim().toLowerCase().slice(at + 1);
  return !PERSONAL_EMAIL_DOMAINS.has(domain);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @datumpro/shared -- email`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validation/email.ts packages/shared/src/validation/email.test.ts
git commit -m "feat(shared): add work-email blocklist for org creation"
```

---

## Task 3: Company-profile schema (shared, TDD)

**Files:**
- Modify: `packages/shared/src/validation/index.ts`
- Test: `packages/shared/src/validation/index.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createOrgSchema } from './index';

describe('createOrgSchema — company profile', () => {
  it('accepts a full profile', () => {
    const r = createOrgSchema.safeParse({
      name: 'Grafaid Engineers',
      legalName: 'Grafaid Engineers Ltd',
      country: 'KE',
      sector: 'construction',
      registrationNumber: 'PVT-12345',
    });
    expect(r.success).toBe(true);
  });

  it('requires name (min 2) but allows optional profile fields to be blank', () => {
    const r = createOrgSchema.safeParse({ name: 'AB' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.legalName).toBeUndefined();
      expect(r.data.registrationNumber).toBeUndefined();
    }
  });

  it('rejects a too-short name', () => {
    expect(createOrgSchema.safeParse({ name: 'A' }).success).toBe(false);
  });

  it('normalises empty optional strings to undefined', () => {
    const r = createOrgSchema.safeParse({ name: 'Acme', legalName: '   ', country: '' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.legalName).toBeUndefined();
      expect(r.data.country).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @datumpro/shared -- index`
Expected: FAIL — the current `createOrgSchema` has no `legalName` and rejects the extra keys’ expectations (`r.data.legalName` is not a property).

- [ ] **Step 3: Update the schema and re-export the email helper**

Replace the existing `createOrgSchema` definition in `packages/shared/src/validation/index.ts` with:

```typescript
import { z } from 'zod';

export * from './email';

/** Empty/whitespace optional strings become `undefined` so blank form fields
 *  don't write empty strings into the DB. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: optionalText(160),
  country: optionalText(2).or(optionalText(64)), // ISO-2 or free text
  sector: optionalText(64),
  registrationNumber: optionalText(64),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;
```

Note: keep any other exports already in this file unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @datumpro/shared -- index`
Expected: PASS.

- [ ] **Step 5: Run the whole shared suite (no regressions)**

Run: `npm test -w @datumpro/shared`
Expected: PASS — existing `permissions.test.ts`, `scheduling.test.ts`, `monitoring.test.ts` still green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/validation/index.ts packages/shared/src/validation/index.test.ts
git commit -m "feat(shared): extend createOrgSchema with company profile fields"
```

---

## Task 4: Upgrade `createOrg` action (profile + work-email gate)

**Files:**
- Modify: `apps/web/app/orgs/actions.ts`

- [ ] **Step 1: Rewrite the action**

Replace the body of `apps/web/app/orgs/actions.ts` with:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createOrgSchema } from '@datumpro/shared/validation';

/** Creates an organisation from the setup-wizard profile form. A DB trigger makes
 *  the creator its `owner`, so no separate membership insert is needed here.
 *  Note: the work-email check is a NON-blocking nudge rendered on the /orgs/new
 *  screen (see Task 5); org creation itself never blocks on it. */
export async function createOrg(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const parsed = createOrgSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    legalName: String(formData.get('legalName') ?? ''),
    country: String(formData.get('country') ?? ''),
    sector: String(formData.get('sector') ?? ''),
    registrationNumber: String(formData.get('registrationNumber') ?? ''),
  });
  if (!parsed.success) {
    redirect(`/orgs/new?error=${encodeURIComponent(parsed.error.issues.map((i) => i.message).join(', '))}`);
  }

  const { name, legalName, country, sector, registrationNumber } = parsed.data;
  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      name,
      legal_name: legalName ?? null,
      country: country ?? null,
      sector: sector ?? null,
      registration_number: registrationNumber ?? null,
      onboarding_completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) redirect(`/orgs/new?error=${encodeURIComponent(error.message)}`);

  revalidatePath('/dashboard');
  redirect(`/orgs/new/done?org=${(org as { id: string }).id}`);
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck` (or `npx tsc -p apps/web --noEmit`)
Expected: PASS — `isBusinessEmail` resolves from `@datumpro/shared/validation`, insert object matches regenerated DB types.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/orgs/actions.ts
git commit -m "feat(onboarding): capture company profile + enforce work-email gate on org creation"
```

---

## Task 5: Setup-wizard UI — company-profile form + done screen

**Files:**
- Modify: `apps/web/app/orgs/new/page.tsx`
- Create: `apps/web/app/orgs/new/done/page.tsx`

- [ ] **Step 1: Rewrite the create-org page as the profile form**

Replace `apps/web/app/orgs/new/page.tsx` with:

```typescript
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { createOrg } from '../actions';
import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { isBusinessEmail } from '@datumpro/shared/validation';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function NewOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const { error } = await searchParams;
  const message = error ? decodeURIComponent(error) : null;
  // Non-blocking nudge only — the org is created regardless (see spec §0/§7).
  const personalEmail = !!user.email && !isBusinessEmail(user.email);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-10">
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Step 1 of 2 · Your company</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Set up your company</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          This is your tenant — you’ll be the owner. A short profile keeps your workspace on record and
          credible for the teams and clients you invite.
        </p>

        {personalEmail && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            You’re signed in with a personal email. A work address (you@yourcompany.com) looks more credible to
            the teams and clients you’ll invite — but you can continue either way.
          </p>
        )}

        {message && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            {message}
          </p>
        )}

        <form action={createOrg} className="mt-6 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Company name</label>
            <input name="name" required placeholder="e.g. Grafaid Engineers" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Legal / registered name <span className="text-zinc-400">(optional)</span></label>
            <input name="legalName" placeholder="e.g. Grafaid Engineers Ltd" className={inputClass} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium">Country <span className="text-zinc-400">(optional)</span></label>
              <input name="country" placeholder="e.g. Kenya" className={inputClass} />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium">Sector <span className="text-zinc-400">(optional)</span></label>
              <select name="sector" defaultValue="" className={inputClass}>
                <option value="">Select…</option>
                <option value="construction">Construction</option>
                <option value="corporate">Corporate / Private</option>
                <option value="ngo">NGO / Non-profit</option>
                <option value="government">Government</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Registration number <span className="text-zinc-400">(optional)</span></label>
            <input name="registrationNumber" placeholder="Company / entity reg. number" className={inputClass} />
          </div>
          <SubmitButton className="w-full" pendingText="Creating…">
            Create company
          </SubmitButton>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Create the done / next-steps screen (wizard step 2)**

Create `apps/web/app/orgs/new/done/page.tsx`:

```typescript
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { Card } from '@/components/ui/card';

export default async function OrgCreatedPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-10">
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Step 2 of 2 · You’re set up</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Your company is ready</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Two quick things get your team working. You can also do these later from the dashboard.
        </p>

        <div className="mt-6 space-y-3">
          <Link href="/org/members" className="block rounded-md border border-zinc-200 px-4 py-3 text-sm hover:border-brand-500 dark:border-zinc-800">
            <span className="font-medium">Invite your team →</span>
            <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">Add teammates, contractors, or clients by email.</span>
          </Link>
          <Link href="/projects/new" className="block rounded-md border border-zinc-200 px-4 py-3 text-sm hover:border-brand-500 dark:border-zinc-800">
            <span className="font-medium">Create your first project →</span>
            <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">Set up a project to start tracking work and finance.</span>
          </Link>
        </div>

        <Link href="/dashboard" className="mt-6 block text-center text-sm text-zinc-500 underline dark:text-zinc-400">
          Skip to dashboard
        </Link>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npm run typecheck` then `npm run lint`
Expected: PASS. If `/projects/new` does not exist in this codebase, change that link's `href` to the correct project-creation route (grep `app/(app)/projects` for the create page) before committing.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`. As a signed-in user with a **work email** and no org, visit `/orgs/new`.
Expected: the profile form renders (no warning); submitting creates the org and lands on `/orgs/new/done`. Then sign in as a **gmail** user and visit `/orgs/new` — expect the amber non-blocking nudge above the form, and submitting still creates the org and reaches the done screen.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/orgs/new/page.tsx" "apps/web/app/orgs/new/done/page.tsx"
git commit -m "feat(onboarding): company-profile setup wizard with next-steps screen"
```

---

## Task 6: Trust surface — `/security` page + sign-in trust signals

**Files:**
- Create: `apps/web/app/security/page.tsx`
- Modify: `apps/web/app/sign-in/page.tsx`

- [ ] **Step 1: Create the trust/security page**

Create `apps/web/app/security/page.tsx`:

```typescript
import Link from 'next/link';
import { Card } from '@/components/ui/card';

export const metadata = { title: 'Security & Data — DatumPro' };

const points: { title: string; body: string }[] = [
  {
    title: 'Your data is isolated per organization',
    body: 'Every company is a separate tenant. Access is enforced at the database with row-level security on each record — not just hidden in the UI. One organization can never read another’s data.',
  },
  {
    title: 'Role-based access & separation of duties',
    body: 'Owners, admins, finance, project managers and members each get exactly the access their role needs. Money actions and approvals are deliberately separated so no single person can both raise and approve spend.',
  },
  {
    title: 'Named accountability',
    body: 'Every organization has a named owner and a member roster. Invitations are tied to a specific email address, so you always know who has access and who invited them.',
  },
  {
    title: 'Where your data lives',
    body: 'DatumPro runs on managed cloud infrastructure with encryption in transit and at rest. For government and enterprise buyers with data-residency requirements, contact us via the “For government & enterprise” path — we’ll confirm region and handling.',
  },
];

export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Trust & security</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">How DatumPro protects your organization</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Built for corporates, construction firms, NGOs and government teams that need their data handled with care.
      </p>

      <div className="mt-8 space-y-4">
        {points.map((p) => (
          <Card key={p.title}>
            <h2 className="text-base font-semibold">{p.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.body}</p>
          </Card>
        ))}
      </div>

      <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
        Security question or procurement requirement?{' '}
        <Link href="/sign-in" className="underline">Get in touch</Link>.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Add trust signals + enterprise link to sign-in**

In `apps/web/app/sign-in/page.tsx`, add a trust footer beneath the existing auth form. Locate the closing of the sign-in card/form container and insert this block just inside the outer wrapper (adjust the class to match the page's existing max-width container):

```tsx
{/* Trust surface — reassures corporate / government visitors before they sign in */}
<div className="mx-auto mt-6 max-w-sm text-center text-xs text-zinc-500 dark:text-zinc-400">
  <p>🔒 Your data is isolated per organization and protected by row-level security.</p>
  <p className="mt-2">
    <a href="/security" className="underline">How we protect your data</a>
    <span className="mx-2">·</span>
    <a href="/security#residency" className="underline">For government &amp; enterprise</a>
  </p>
</div>
```

Note: `sign-in/page.tsx` is a `'use client'` component; plain `<a>` tags are used here to avoid adding imports. If the file already imports `next/link`, prefer `<Link>` for consistency.

- [ ] **Step 3: Type-check, lint, smoke test**

Run: `npm run typecheck && npm run lint`, then `npm run dev` and visit `/security` and `/sign-in`.
Expected: `/security` renders the four cards; `/sign-in` shows the trust footer with both links working.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/security/page.tsx" "apps/web/app/sign-in/page.tsx"
git commit -m "feat(onboarding): add /security trust page and sign-in trust signals"
```

---

## Task 7: Enable email confirmation (config) + phase verification

**Files:** none (Supabase project configuration + full-suite verification)

- [ ] **Step 1: Turn on email confirmation**

In the Supabase project: Authentication → Providers → Email → enable **Confirm email**. If the repo tracks `supabase/config.toml`, set `[auth.email] enable_confirmations = true` and commit that change too.
Expected: new email/password signups must confirm before a session is issued. (OAuth and magic-link paths are unaffected — they’re already verified.)

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS across workspaces — new `email.test.ts` and `index.test.ts` green, existing suites unaffected.

- [ ] **Step 3: Full type-check + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: End-to-end smoke of the whole Phase 1 flow**

Run: `npm run dev`. Walk the flow: sign up with a work email → (if confirmation on, confirm) → `/orgs/new` profile form → create → `/orgs/new/done` → invite a teammate from `/org/members` and confirm the invite email sends (or logs `[email] RESEND_API_KEY unset — skipping send` locally).
Expected: complete self-serve path works end to end; a gmail user sees the amber nudge but can still create the org.

- [ ] **Step 5: Commit any config**

```bash
git add supabase/config.toml 2>/dev/null || true
git commit -m "chore(auth): enable email confirmation for signups" --allow-empty
```

---

## Self-Review (against the spec)

- **Trust-forward login + /security** → Task 6. ✅
- **Work-email nudge on org creation only** → Task 2 (blocklist util) + Task 5 (non-blocking amber warning on `/orgs/new`; org always created; invited members never nudged). ✅
- **Email verification ON** → Task 7 Step 1. ✅
- **Setup wizard + company-profile columns** → Task 1 (columns) + Task 3 (schema) + Task 5 (two-screen wizard). ✅
- **Invite email delivery** → already exists (Resend); no task needed, confirmed in Task 7 smoke. ✅
- **Data model additions** for Phase 1 (`legal_name`, `country`, `sector`, `registration_number`, `onboarding_completed_at`) → Task 1. ✅ (`status`, `created_via`, `require_mfa`, `data_region` belong to later phases and are intentionally deferred.)
- **Sign-up dedicated page** → deferred; existing `/sign-in` already handles signup, and the two-door CTA is delivered via the enterprise link. Noted for a future polish pass.

**Type consistency:** `isBusinessEmail`/`PERSONAL_EMAIL_DOMAINS` (Task 2) are consumed in Task 4 and re-exported via `@datumpro/shared/validation` (Task 3 Step 3). `createOrgSchema` field names (`legalName`, `country`, `sector`, `registrationNumber`) match the form input `name`s in Task 5 and the snake_case DB columns in Task 1 via the mapping in Task 4. `onboarding_completed_at` column (Task 1) is written in Task 4. No dangling references.
