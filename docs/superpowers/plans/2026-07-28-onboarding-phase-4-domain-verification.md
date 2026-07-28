# Onboarding Phase 4 — Verified Domains + Auto-Join

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org prove it controls an email domain (e.g. `acme.com`) via a DNS TXT record, then offer new users whose email matches a *verified* domain a one-click "join your company" on the no-org screen — killing duplicate "shadow orgs".

**Architecture:** A new `org_domains` table (admin-managed under RLS) holds each claimed domain + a verification token; a globally-unique constraint on *verified* domains means only one org can own a domain. Verification is a server action that does a `node:dns` TXT lookup. Auto-join never leaks which domains belong to which org: a SECURITY DEFINER RPC answers only "is the *current user's* domain claimed?", and a second SECURITY DEFINER RPC performs the join after re-checking server-side, adding the user at the lowest role. Personal domains (gmail, …) are blocked from ever being claimed.

**Tech Stack:** Next.js 15 (App Router, Server Actions, Node runtime), Supabase (Postgres + RLS, SECURITY DEFINER RPCs), `node:dns`, TailwindCSS v4. pnpm workspace.

**Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm dev`.

**Scope (locked with the user):**
- **In scope:** verified domains (DNS TXT) + **offer-to-join** (user clicks; joins at lowest role; nothing silent, no admin-approval queue).
- **Out of scope / deferred:** **SSO / SAML** — Supabase SAML is Pro/Enterprise-tier and configured in the dashboard, not app code; it can't be built or tested from here. This plan is the buildable half of spec §8 Phase 4. When SSO is wanted, it's a dashboard configuration + a "Sign in with SSO" button, tracked separately.

Phase 4 (partial) of `docs/superpowers/specs/2026-07-27-access-onboarding-design.md` §8.

---

## File Structure

**Create:**
- `supabase/migrations/20260101007300_org_domains.sql` — table + `find_joinable_org` + `join_org_by_domain` RPCs.
- `apps/web/app/(app)/org/domain-actions.ts` — add / verify / remove domain server actions.
- `apps/web/app/(app)/dashboard/join-actions.ts` — `joinOrgByDomain` server action.

**Modify:**
- `packages/shared/src/validation/email.ts` — export `isPersonalEmailDomain(domain)` (+ test).
- `apps/web/app/(app)/org/page.tsx` — "Verified domains" admin card.
- `apps/web/app/(app)/dashboard/page.tsx` — no-org "join your company" offer.

---

## Task 1: `org_domains` table + join RPCs

**Files:**
- Create: `supabase/migrations/20260101007300_org_domains.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — verified email domains + auto-join
--
-- An org claims a domain and proves control via a DNS TXT record. Only ONE org
-- may hold a VERIFIED domain (partial unique index). New users whose email domain
-- matches a verified domain are offered a one-click join at the lowest role. The
-- domain→org mapping is never publicly readable; two SECURITY DEFINER RPCs expose
-- only "is the current user's own domain claimable?" and "join it".
-- ─────────────────────────────────────────────────────────────────────────────

create table public.org_domains (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  domain             text not null,          -- bare, lowercased, e.g. 'acme.com'
  verification_token text not null,
  verified_at        timestamptz,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (org_id, domain)                     -- no duplicate claim within an org
);
-- Exactly one org may VERIFY a given domain, globally.
create unique index org_domains_verified_domain_uidx
  on public.org_domains (domain) where verified_at is not null;
create index org_domains_org_idx on public.org_domains (org_id);

alter table public.org_domains enable row level security;

-- Admins manage their own org's domains. No public read — the auto-join RPCs below
-- are the only path for a non-admin to learn a domain is claimed (and only their own).
create policy org_domains_select on public.org_domains for select
  using ((select public.is_org_admin(org_id)));
create policy org_domains_insert on public.org_domains for insert
  with check ((select public.is_org_admin(org_id)));
create policy org_domains_update on public.org_domains for update
  using ((select public.is_org_admin(org_id)));
create policy org_domains_delete on public.org_domains for delete
  using ((select public.is_org_admin(org_id)));

-- "Is the CURRENT user's email domain a verified domain of some org they're not in?"
-- Returns at most one org (id + name). Never exposes other users' or other domains'
-- mappings — it only ever looks up the caller's own email domain.
create or replace function public.find_joinable_org()
returns table (org_id uuid, org_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  uemail  text;
  udomain text;
begin
  select email into uemail from auth.users where id = (select auth.uid());
  if uemail is null then return; end if;
  udomain := lower(split_part(uemail, '@', 2));
  if udomain = '' then return; end if;

  return query
    select o.id, o.name
    from public.org_domains d
    join public.organizations o on o.id = d.org_id
    where d.verified_at is not null
      and lower(d.domain) = udomain
      and not exists (
        select 1 from public.org_members m
        where m.org_id = o.id and m.user_id = (select auth.uid())
      )
    limit 1;
end;
$$;

-- Join an org by a verified domain match. Re-checks the caller's email domain
-- server-side (never trusts the client) and adds them at the lowest role.
create or replace function public.join_org_by_domain(p_org_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := (select auth.uid());
  uemail  text;
  udomain text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select email into uemail from auth.users where id = uid;
  udomain := lower(split_part(coalesce(uemail, ''), '@', 2));

  if not exists (
    select 1 from public.org_domains d
    where d.org_id = p_org_id and d.verified_at is not null and lower(d.domain) = udomain
  ) then
    raise exception 'your email domain is not a verified domain for this organisation';
  end if;

  insert into public.org_members (org_id, user_id, role, member_type, status)
  values (p_org_id, uid, 'member', 'staff', 'active')
  on conflict (org_id, user_id) do nothing;

  return p_org_id;
end;
$$;
```

- [ ] **Step 2: Apply**

Run: `pnpm db:reset` locally, or apply to the hosted DB via the Supabase tooling.
Expected: `org_domains` exists with RLS + policies; the two RPCs are callable. Confirm the `('member','staff')` role/member_type pair is accepted by the member-type-lock trigger (it maps staff→member); if the insert is rejected, adjust to the trigger's expected pair.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101007300_org_domains.sql
git commit -m "feat(domains): org_domains table + find/join RPCs for auto-join"
```

---

## Task 2: `isPersonalEmailDomain` helper (shared, TDD)

**Files:**
- Modify: `packages/shared/src/validation/email.ts`
- Modify: `packages/shared/src/validation/email.test.ts`

- [ ] **Step 1: Add the failing test.** Append to `packages/shared/src/validation/email.test.ts`:

```typescript
import { isPersonalEmailDomain } from './email';

describe('isPersonalEmailDomain — block personal domains from being claimed', () => {
  it('flags free providers', () => {
    expect(isPersonalEmailDomain('gmail.com')).toBe(true);
    expect(isPersonalEmailDomain('GMAIL.COM')).toBe(true);
    expect(isPersonalEmailDomain('  outlook.com ')).toBe(true);
  });
  it('passes company domains', () => {
    expect(isPersonalEmailDomain('acme.com')).toBe(false);
    expect(isPersonalEmailDomain('grafaid.co.ke')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd packages/shared && npx vitest run email`
Expected: FAIL — `isPersonalEmailDomain` is not exported.

- [ ] **Step 3: Implement.** Append to `packages/shared/src/validation/email.ts`:

```typescript
/** True when `domain` (a bare domain, not an email) is a known free/personal
 *  provider — used to refuse verifying it as an org domain. */
export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd packages/shared && npx vitest run email`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validation/email.ts packages/shared/src/validation/email.test.ts
git commit -m "feat(shared): isPersonalEmailDomain helper for domain claims"
```

---

## Task 3: Domain server actions (add / verify / remove)

**Files:**
- Create: `apps/web/app/(app)/org/domain-actions.ts`

- [ ] **Step 1: Write the actions**

```typescript
'use server';

import { promises as dns } from 'node:dns';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isPersonalEmailDomain } from '@datumpro/shared/validation';
import { logAudit } from '@/lib/audit';

const ORG = '/org';

/** Bare-domain sanity: lowercase, no scheme/path, at least one dot. */
function normalizeDomain(raw: string): string | null {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^@/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

export async function addOrgDomain(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const domain = normalizeDomain(String(formData.get('domain') ?? ''));
  if (!orgId) throw new Error('Missing organisation');
  if (!domain) redirect(`${ORG}?derror=${encodeURIComponent('Enter a valid domain, e.g. acme.com')}`);
  if (isPersonalEmailDomain(domain)) {
    redirect(`${ORG}?derror=${encodeURIComponent('Personal email domains (gmail, outlook, …) can’t be claimed.')}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const token = `datumpro-verify=${crypto.randomUUID().replace(/-/g, '')}`;
  const { error } = await supabase
    .from('org_domains')
    .insert({ org_id: orgId, domain, verification_token: token, created_by: user.id });
  if (error) {
    redirect(`${ORG}?derror=${encodeURIComponent(error.code === '23505' ? 'That domain is already added.' : error.message)}`);
  }
  await logAudit({ orgId, actorId: user.id, entityType: 'org_domain', entityId: null, action: 'domain.added', after: { domain } });
  revalidatePath(ORG);
  redirect(ORG);
}

export async function verifyOrgDomain(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!orgId || !id) throw new Error('Missing domain');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: row } = await supabase
    .from('org_domains')
    .select('domain, verification_token')
    .eq('id', id)
    .single();
  const rec = row as { domain: string; verification_token: string } | null;
  if (!rec) redirect(`${ORG}?derror=${encodeURIComponent('Domain not found.')}`);

  // Look up the domain's TXT records and match the expected token. TXT records can
  // be chunked, so join each record's parts before comparing.
  let found = false;
  try {
    const records = await dns.resolveTxt(rec.domain);
    found = records.some((parts) => parts.join('').trim() === rec.verification_token);
  } catch {
    found = false; // NXDOMAIN / no TXT — treated as not verified
  }
  if (!found) {
    redirect(`${ORG}?derror=${encodeURIComponent(`No matching TXT record yet. Add a TXT record with value "${rec.verification_token}" and try again (DNS can take a few minutes).`)}`);
  }

  const { error } = await supabase.from('org_domains').update({ verified_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    redirect(`${ORG}?derror=${encodeURIComponent(error.code === '23505' ? 'That domain is already verified by another organisation.' : error.message)}`);
  }
  await logAudit({ orgId, actorId: user.id, entityType: 'org_domain', entityId: id, action: 'domain.verified', after: { domain: rec.domain } });
  revalidatePath(ORG);
  redirect(`${ORG}?dok=1`);
}

export async function removeOrgDomain(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!orgId || !id) throw new Error('Missing domain');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.from('org_domains').delete().eq('id', id);
  if (error) redirect(`${ORG}?derror=${encodeURIComponent(error.message)}`);
  await logAudit({ orgId, actorId: user.id, entityType: 'org_domain', entityId: id, action: 'domain.removed' });
  revalidatePath(ORG);
  redirect(ORG);
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/org/domain-actions.ts"
git commit -m "feat(domains): add/verify(DNS TXT)/remove org domain actions"
```

---

## Task 4: "Verified domains" card on the org page

**Files:**
- Modify: `apps/web/app/(app)/org/page.tsx`

- [ ] **Step 1: Load domains + render the card.** The `/org` page is already owner/admin-gated. Add to the imports:

```typescript
import { addOrgDomain, verifyOrgDomain, removeOrgDomain } from './domain-actions';
```

Extend the existing `Promise.all` (which already fetches members, invitations, secondApprover, and the org's `require_mfa` row via `supabase`) to also load domains:

```typescript
    supabase
      .from('org_domains')
      .select('id, domain, verified_at, verification_token')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
```

Capture it (name the destructured result `{ data: domains }`) and coerce:

```typescript
  const domainRows = (domains ?? []) as {
    id: string;
    domain: string;
    verified_at: string | null;
    verification_token: string;
  }[];
```

Also read the page's search params for the inline banner. Add to the page's props (the page currently has no `searchParams` — add it):

```typescript
export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ derror?: string; dok?: string }>;
}) {
  // ...existing body...
  const { derror, dok } = await searchParams;
```

Render this card inside the `<section>` (near the Security card):

```tsx
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
                      <button type="submit" className="text-sm text-zinc-500 underline hover:text-red-600">
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

          <form action={addOrgDomain} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="orgId" value={orgId} />
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-xs font-medium">Add a domain</label>
              <input name="domain" required placeholder="acme.com" className={inputClass} />
            </div>
            <SubmitButton pendingText="Adding…">Add domain</SubmitButton>
          </form>
        </Card>
```

`SubmitButton` is already imported on this page (Phase 2); `Card`/`CardTitle`/`inputClass` exist.

- [ ] **Step 2: Type-check, lint, smoke**

Run: `pnpm typecheck && pnpm lint`, then `pnpm dev`, sign in as an owner/admin, open `/org`.
Expected: the card lists domains; adding `acme.com` shows a pending row with the TXT token; "Verify" reports the TXT instruction when the record is absent; a personal domain is refused.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/org/page.tsx"
git commit -m "feat(domains): verified-domains management card on /org"
```

---

## Task 5: No-org "join your company" offer

**Files:**
- Create: `apps/web/app/(app)/dashboard/join-actions.ts`
- Modify: `apps/web/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Join server action.** Create `apps/web/app/(app)/dashboard/join-actions.ts`:

```typescript
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACTIVE_ORG_COOKIE } from '@/lib/data/org';
import { logAudit } from '@/lib/audit';

/** Join an org whose verified domain matches the signed-in user's email. The RPC
 *  re-checks the domain server-side and adds the user at the lowest role. */
export async function joinOrgByDomain(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (!orgId) throw new Error('Missing organisation');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.rpc('join_org_by_domain', { p_org_id: orgId });
  if (error) redirect('/dashboard?joinerror=' + encodeURIComponent(error.message));

  await logAudit({ orgId, actorId: user.id, entityType: 'org_member', entityId: user.id, action: 'member.joined_by_domain' });

  // Make the joined org active and land in it.
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

// createAdminClient is intentionally unused here — kept for symmetry docs only.
void createAdminClient;
```

Note: drop the trailing `void createAdminClient;` and its import — they are illustrative only. Final file imports just `cookies`, `redirect`, `revalidatePath`, `createClient`, `ACTIVE_ORG_COOKIE`, `logAudit`.

- [ ] **Step 2: Render the offer in the no-org state.** In `apps/web/app/(app)/dashboard/page.tsx`, replace the `if (!ctx.active) { … }` block (lines 34-48) with a version that checks `find_joinable_org` first:

```tsx
  // No organisation yet → onboarding (rendered without the sidebar by the layout).
  if (!ctx.active) {
    const supabase = await createClient();
    const { data: joinable } = await supabase.rpc('find_joinable_org');
    const offer = ((joinable ?? []) as { org_id: string; org_name: string }[])[0] ?? null;

    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome to DatumPro</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {offer ? 'Your company is already on DatumPro.' : 'Create your company to get started.'}
          </p>
        </div>

        {offer && (
          <Card className="w-full text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{offer.org_name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Join as a member</p>
              </div>
              <form action={joinOrgByDomain}>
                <input type="hidden" name="orgId" value={offer.org_id} />
                <SubmitButton pendingText="Joining…">Join</SubmitButton>
              </form>
            </div>
          </Card>
        )}

        <div className="text-xs text-zinc-400">{offer ? 'or' : ''}</div>

        <Link href="/orgs/new">
          <Button variant={offer ? 'secondary' : undefined}>Create a new company</Button>
        </Link>
      </main>
    );
  }
```

Add the imports at the top of the file (alongside the existing ones):

```typescript
import { SubmitButton } from '@/components/ui/submit-button';
import { joinOrgByDomain } from './join-actions';
```

(`Card`, `Button`, `Link`, `createClient` are already imported on this page.)

- [ ] **Step 3: Type-check, lint, smoke**

Run: `pnpm typecheck && pnpm lint`, then `pnpm dev`. With a verified domain on an org, sign in as a NEW user whose email matches that domain and has no org.
Expected: the no-org screen shows a "Join {org}" card plus "Create a new company"; clicking Join adds the user as a member and lands them in that org's dashboard. A user with no matching domain sees only "Create a new company".

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/dashboard/join-actions.ts" "apps/web/app/(app)/dashboard/page.tsx"
git commit -m "feat(domains): offer domain-matched users a one-click join"
```

---

## Self-Review (against the spec §8 Phase 4)

- **Verified domains (DNS proof)** → Task 1 (table, partial-unique on verified), Task 3 (add/verify via `node:dns`/remove). ✅
- **Auto-join (offer)** → Task 1 RPCs (`find_joinable_org`, `join_org_by_domain`), Task 5 (no-org offer + join action). ✅
- **No shadow orgs / one owner per domain** → `org_domains_verified_domain_uidx` partial unique. ✅
- **Personal domains can't be claimed** → Task 2 (`isPersonalEmailDomain`) enforced in `addOrgDomain`. ✅
- **No leak of domain→org mapping** → `org_domains` RLS admin-only; `find_joinable_org` only ever matches the caller's own email domain. ✅
- **Audit** → domain.added / verified / removed and member.joined_by_domain via `logAudit`. ✅
- **SSO / SAML** → out of scope (Pro-tier, dashboard config); documented, not built. ✅

**Type consistency:** RPC names (`find_joinable_org`, `join_org_by_domain`) match the `.rpc(...)` calls (Tasks 5). `org_domains` columns (`domain`, `verification_token`, `verified_at`) match the selects/inserts in Tasks 3–4. Action form field names (`orgId`, `id`, `domain`) match `formData.get(...)`. `isPersonalEmailDomain` (Task 2) is consumed in Task 3. Join inserts `role 'member', member_type 'staff'` (Task 1) — confirm against the member-type-lock trigger during Step 2 apply.

**Security notes:** both write RPCs are SECURITY DEFINER with `search_path = ''`; `join_org_by_domain` re-derives the email domain from `auth.users` server-side (never trusts client input) and adds the lowest role; DNS failures fail closed (not verified).
