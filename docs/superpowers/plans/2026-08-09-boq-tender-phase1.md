# BOQ Sealed Tender — Phase 1 (Bidding Side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff put a BOQ out to sealed tender, invite bidding companies (existing contractor members or new-by-email), and let each bidder price the bill online — with the budget rate and other bids hidden — up to a deadline.

**Architecture:** Three new org-scoped tables (`boq_tenders`, `boq_bidders`, `boq_bid_items`) with composite-`(id, org_id)` FK tenancy mirroring the BOQ tables. Sealing is a *practical soft-seal*: staff can read bid prices only after `unsealed_at` is set (RLS gate); bidders read the bill through a **view that omits `budget_rate_cents`** and can read/write only their own bid, keyed on `auth.uid() = boq_bidders.user_id`. Bidders authenticate as light accounts linked via an invite RPC (mirrors `accept_org_invitation`). Owner-side comparison/unseal/award is **Phase 2** — out of scope here.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase Postgres + RLS, `@supabase/ssr`, Resend (transactional email via `apps/web/lib/email/resend.ts`), Zod validation in `@datumpro/shared`.

**Verification reality:** No JS test runner in this repo. Each task verifies via (a) SQL assertions appended to `supabase/tests/rls_security.sql`, run through a rolled-back transaction via the Supabase MCP or local `supabase db reset`; (b) `pnpm turbo run typecheck lint --filter=@datumpro/web --filter=@datumpro/shared`; (c) manual DB simulation of owner (pre/post-unseal) and bidder roles.

**Reference patterns to mirror (read these first):**
- `supabase/migrations/20260101008200_boq_estimates.sql` — table + composite-FK + RLS shape.
- `supabase/migrations/20260101007500_create_org_rpc.sql` — `SECURITY DEFINER` create RPC returning a scalar (avoids RLS-on-RETURNING).
- `supabase/migrations/20260101002500_accept_invitation_updates_type.sql` — token-bound accept RPC pattern.
- `apps/web/lib/data/boq.ts`, `apps/web/app/(app)/boq/actions.ts`, `apps/web/app/(app)/boq/[boqId]/boq-builder.tsx` — data-layer, server-action, and grid-UI conventions.
- `apps/web/app/(app)/org/members/actions.ts` (`inviteMember`) + `apps/web/lib/email/resend.ts` — invite + email pattern.

---

## File Structure

**Create:**
- `supabase/migrations/20260101008400_boq_tenders.sql` — tables, enums, indexes, generated helpers.
- `supabase/migrations/20260101008500_boq_tender_rls.sql` — RLS, soft-seal gate, bidder view, `is_tender_bidder()`, `create_tender()`, `invite_boq_bidder()`, `accept_boq_bid_invite()`, `submit_boq_bid()`.
- `packages/shared/src/domain/tender.ts` — statuses + labels.
- `apps/web/lib/data/tender.ts` — reads: `getTenderForOwner`, `listBidders`, `getBidWorkspace` (bidder side).
- `apps/web/app/(app)/boq/[boqId]/tender/page.tsx` — owner tender dashboard (setup + bidder list + statuses).
- `apps/web/app/(app)/boq/[boqId]/tender/actions.ts` — owner actions: `createTender`, `inviteBidder`, `resendBidInvite`, `revokeBidder`, `closeTender`.
- `apps/web/app/(app)/boq/[boqId]/tender/bidders-panel.tsx` — client: invite (existing/new) + bidder rows with status.
- `apps/web/app/tender/[token]/page.tsx` — bidder entry (accept invite → workspace).
- `apps/web/app/tender/[token]/bid-workspace.tsx` — client: the pricing grid + submit.
- `apps/web/app/tender/[token]/actions.ts` — bidder actions: `saveBidRate`, `submitBid` (wrap the RPCs).

**Modify:**
- `apps/web/app/(app)/boq/[boqId]/boq-builder.tsx` — add a "Put out to tender" / "Manage tender" button linking to the tender dashboard.
- `apps/web/middleware.ts` — add `/tender` to `protectedPrefixes` (bidder pages require a session).
- `supabase/tests/rls_security.sql` — append tender tenant-isolation + seal + bidder-scope assertions.

---

## Task 1: Tender schema migration

**Files:**
- Create: `supabase/migrations/20260101008400_boq_tenders.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ sealed tender (Phase 1: schema)
-- A tender puts one BOQ out to bid. Bidders (existing contractor members or new
-- companies invited by email) price the SAME bill online; prices stay hidden from
-- staff until unsealed. Tenancy mirrors the BOQ tables: every row carries org_id
-- and references its parent by the composite (id, org_id) key.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.tender_status as enum ('draft', 'open', 'closed', 'awarded', 'cancelled');
create type public.bidder_status as enum ('invited', 'viewing', 'submitted', 'withdrawn');

-- One tender per BOQ put to bid (a BOQ may be re-tendered over time → many rows,
-- newest active one wins in the UI).
create table public.boq_tenders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  boq_id            uuid not null,
  title             text not null,
  close_at          timestamptz,                        -- deadline; null = open-ended until closed manually
  status            public.tender_status not null default 'draft',
  unsealed_at       timestamptz,                        -- set once → staff may read bid prices
  awarded_bidder_id uuid,                               -- FK added in RLS migration (avoids cycle at create time)
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint boq_tenders_id_org_key unique (id, org_id),
  foreign key (boq_id, org_id) references public.boqs (id, org_id) on delete cascade
);
create index boq_tenders_org_idx on public.boq_tenders (org_id);
create index boq_tenders_boq_idx on public.boq_tenders (boq_id);

-- A company invited to a tender. user_id is set immediately for an existing
-- member, or on accept for a new email invite (mirrors org_invitations).
create table public.boq_bidders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  tender_id     uuid not null,
  company_name  text not null,
  contact_email text not null,
  user_id       uuid references auth.users(id) on delete set null,
  invite_token  text not null unique,
  status        public.bidder_status not null default 'invited',
  invited_by    uuid references auth.users(id) on delete set null,
  invited_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  constraint boq_bidders_id_org_key unique (id, org_id),
  foreign key (tender_id, org_id) references public.boq_tenders (id, org_id) on delete cascade
);
-- One live invite per email per tender (case-insensitive).
create unique index boq_bidders_one_per_email
  on public.boq_bidders (tender_id, lower(contact_email));
create index boq_bidders_user_idx on public.boq_bidders (user_id);

-- Now the tender's award FK can point at a bidder.
alter table public.boq_tenders
  add constraint boq_tenders_awarded_fk
  foreign key (awarded_bidder_id) references public.boq_bidders(id) on delete set null;

-- A bidder's price for one BOQ line. The quantity comes from the owner's
-- boq_items row; total is qty × rate, computed in the read view (qty lives on
-- another table so it can't be a generated column here).
create table public.boq_bid_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  bidder_id    uuid not null,
  boq_item_id  uuid not null,
  rate_cents   bigint not null default 0,
  no_bid       boolean not null default false,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint boq_bid_items_id_org_key unique (id, org_id),
  constraint boq_bid_items_one_per_line unique (bidder_id, boq_item_id),
  foreign key (bidder_id, org_id)   references public.boq_bidders (id, org_id) on delete cascade,
  foreign key (boq_item_id, org_id) references public.boq_items   (id, org_id) on delete cascade
);
create index boq_bid_items_bidder_idx on public.boq_bid_items (bidder_id);
```

> NOTE: `boq_items` must expose a `unique (id, org_id)` for the composite FK above. Migration `20260101008200` already declares `constraint boq_items_id_org_key unique (id, org_id)` — confirm before running; if absent, add it in this migration first.

- [ ] **Step 2: Apply and verify structure**

Apply via the Supabase MCP `apply_migration` (name `boq_tenders`) OR `supabase db reset` locally. Then verify:

```sql
select count(*) as tables from information_schema.tables
where table_schema='public' and table_name in ('boq_tenders','boq_bidders','boq_bid_items');
-- expect 3
```
Expected: `tables = 3`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101008400_boq_tenders.sql
git commit -m "feat(tender): Phase 1 schema — boq_tenders / boq_bidders / boq_bid_items"
```

---

## Task 2: RLS, soft-seal, bidder view, and RPCs

**Files:**
- Create: `supabase/migrations/20260101008500_boq_tender_rls.sql`

- [ ] **Step 1: Write helper + membership predicate**

```sql
-- True if the current user is an active bidder on this tender (used to grant
-- bidders scoped read of the bill + read/write of their own bid). SECURITY
-- DEFINER so it can read boq_bidders without RLS recursion.
create or replace function public.is_tender_bidder(p_tender_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boq_bidders b
    where b.tender_id = p_tender_id
      and b.user_id = (select auth.uid())
      and b.status <> 'withdrawn'
  );
$$;

-- The bidder_id owned by the current user on a tender (null if none).
create or replace function public.my_bidder_id(p_tender_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select b.id from public.boq_bidders b
  where b.tender_id = p_tender_id and b.user_id = (select auth.uid())
  limit 1;
$$;
```

- [ ] **Step 2: Enable RLS + owner/staff policies (with the soft-seal gate)**

```sql
alter table public.boq_tenders   enable row level security;
alter table public.boq_bidders   enable row level security;
alter table public.boq_bid_items enable row level security;

-- TENDERS: any org member reads; admins/PMs manage. Bidders read the tender rows
-- they're invited to (so the bidder screen can load title/close_at/status).
create policy boq_tenders_select on public.boq_tenders for select
  using ((select public.is_org_member(org_id)) or (select public.is_tender_bidder(id)));
create policy boq_tenders_write on public.boq_tenders for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');

-- BIDDERS: staff (admin/PM) manage the invite list; a bidder may read their OWN row.
create policy boq_bidders_staff on public.boq_bidders for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');
create policy boq_bidders_self_read on public.boq_bidders for select
  using (user_id = (select auth.uid()));

-- BID ITEMS — the sealed prices.
-- (a) Staff may READ prices ONLY after the tender is unsealed (soft-seal gate).
create policy boq_bid_items_staff_read on public.boq_bid_items for select
  using (
    ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
    and exists (
      select 1 from public.boq_bidders bd
      join public.boq_tenders t on t.id = bd.tender_id
      where bd.id = boq_bid_items.bidder_id and t.unsealed_at is not null
    )
  );
-- (b) A bidder may READ/WRITE their OWN bid items, only while their bid is still
--     open (status 'invited'/'viewing') — locked once 'submitted'/'withdrawn'.
create policy boq_bid_items_bidder_rw on public.boq_bid_items for all
  using (
    exists (select 1 from public.boq_bidders bd
            where bd.id = boq_bid_items.bidder_id
              and bd.user_id = (select auth.uid())
              and bd.status in ('invited','viewing'))
  )
  with check (
    exists (select 1 from public.boq_bidders bd
            where bd.id = boq_bid_items.bidder_id
              and bd.user_id = (select auth.uid())
              and bd.status in ('invited','viewing'))
  );
```

- [ ] **Step 3: Bidder-safe bill view (excludes the budget rate)**

```sql
-- Bidders price against this projection — it NEVER exposes budget_rate_cents.
-- security_invoker so the caller's RLS on boqs/boq_sections/boq_items applies…
-- but bidders aren't org members, so we also grant them read via is_tender_bidder
-- by exposing the lines only for tenders they bid on. Implemented as a SECURITY
-- DEFINER function returning the line set for a tender the caller may bid on.
create or replace function public.tender_bill_lines(p_tender_id uuid)
returns table (
  section_id uuid, section_name text, section_position int,
  item_id uuid, description text, uom text, qty numeric, item_position int
) language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.position,
         i.id, i.description, i.uom, i.qty, i.position
  from public.boq_tenders t
  join public.boqs b            on b.id = t.boq_id
  join public.boq_sections s    on s.boq_id = b.id
  join public.boq_items i       on i.section_id = s.id
  where t.id = p_tender_id
    and (public.is_tender_bidder(p_tender_id) or public.is_org_member(t.org_id))
  order by s.position, i.position;
$$;
revoke all on function public.tender_bill_lines(uuid) from public;
grant execute on function public.tender_bill_lines(uuid) to authenticated;
```

- [ ] **Step 4: Create-tender + invite + accept + submit RPCs**

```sql
-- Put a BOQ out to tender (staff). SECURITY DEFINER → returns id as a scalar,
-- avoiding the RLS-on-RETURNING trap (see create_organization).
create or replace function public.create_tender(p_boq_id uuid, p_title text, p_close_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); v_org uuid; new_id uuid;
begin
  select org_id into v_org from public.boqs where id = p_boq_id;
  if v_org is null then raise exception 'boq not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
    raise exception 'not authorised';
  end if;
  insert into public.boq_tenders (org_id, boq_id, title, close_at, status, created_by)
  values (v_org, p_boq_id, coalesce(nullif(trim(p_title),''), 'Tender'), p_close_at, 'open', uid)
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.create_tender(uuid, text, timestamptz) from public;
grant execute on function public.create_tender(uuid, text, timestamptz) to authenticated;

-- Invite a bidder (existing member by user_id OR new by email). Idempotent per
-- (tender, email). Returns the bidder id + token so the caller can email the link.
create or replace function public.invite_boq_bidder(
  p_tender_id uuid, p_company_name text, p_email text, p_user_id uuid default null
) returns table (bidder_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select org_id into v_org from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
    raise exception 'not authorised';
  end if;
  insert into public.boq_bidders (org_id, tender_id, company_name, contact_email, user_id, invite_token, invited_by)
  values (v_org, p_tender_id, trim(p_company_name), lower(trim(p_email)), p_user_id, v_token, (select auth.uid()))
  on conflict (tender_id, lower(contact_email)) do update
    set company_name = excluded.company_name, user_id = coalesce(public.boq_bidders.user_id, excluded.user_id)
  returning id, invite_token into bidder_id, token;
  return next;
end; $$;
revoke all on function public.invite_boq_bidder(uuid, text, text, uuid) from public;
grant execute on function public.invite_boq_bidder(uuid, text, text, uuid) to authenticated;

-- A signed-in invitee claims their bidder row via the token. Binds to email like
-- accept_org_invitation. Returns the tender_id so the app can route to pricing.
create or replace function public.accept_boq_bid_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare bd public.boq_bidders; uid uuid := (select auth.uid()); uemail text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into bd from public.boq_bidders where invite_token = p_token;
  if not found then raise exception 'invitation not found'; end if;
  if bd.status = 'withdrawn' then raise exception 'invitation withdrawn'; end if;
  select lower(email) into uemail from auth.users where id = uid;
  if uemail is distinct from lower(bd.contact_email) then
    raise exception 'invitation was sent to a different email address';
  end if;
  update public.boq_bidders
    set user_id = uid, status = case when status = 'invited' then 'viewing' else status end
    where id = bd.id;
  return bd.tender_id;
end; $$;
revoke all on function public.accept_boq_bid_invite(text) from public;
grant execute on function public.accept_boq_bid_invite(text) to authenticated;

-- Finalise a bid: flips the bidder to 'submitted' (which the RW policy then locks).
-- Enforces the deadline server-side.
create or replace function public.submit_boq_bid(p_bidder_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare bd public.boq_bidders; t public.boq_tenders;
begin
  select * into bd from public.boq_bidders where id = p_bidder_id;
  if not found or bd.user_id is distinct from (select auth.uid()) then
    raise exception 'not your bid'; end if;
  select * into t from public.boq_tenders where id = bd.tender_id;
  if t.close_at is not null and t.close_at < now() then raise exception 'tender closed'; end if;
  if bd.status not in ('invited','viewing') then raise exception 'already submitted'; end if;
  update public.boq_bidders set status = 'submitted', submitted_at = now() where id = bd.id;
end; $$;
revoke all on function public.submit_boq_bid(uuid) from public;
grant execute on function public.submit_boq_bid(uuid) to authenticated;
```

- [ ] **Step 2..4 verification (RLS assertions):** see Task 3 (write those first, run after applying).

- [ ] **Step 5: Apply + commit**

Apply via MCP `apply_migration` (name `boq_tender_rls`). Then:

```bash
git add supabase/migrations/20260101008500_boq_tender_rls.sql
git commit -m "feat(tender): RLS soft-seal, bidder-safe bill view, tender/invite/accept/submit RPCs"
```

---

## Task 3: RLS regression assertions

**Files:**
- Modify: `supabase/tests/rls_security.sql` (append a tender section, following the file's existing `set local role` / `set local request.jwt.claims` idiom)

- [ ] **Step 1: Append assertions**

Add a block that, inside `begin; … rollback;` transactions, asserts:
1. **Seal holds:** as an admin (`set local role authenticated` + claims for an org admin), before `unsealed_at`, `select count(*) from boq_bid_items` for a seeded bid returns **0**; after setting `unsealed_at`, returns the real count.
2. **Bidder isolation:** as bidder A (claims = A's user_id), `select` on `boq_bid_items` returns only A's rows (0 of B's); `tender_bill_lines(tender)` returns lines but the result has **no** `budget_rate_cents` column.
3. **Tenant isolation:** a user from another org sees 0 tenders/bidders/bid_items.
4. **Write lock:** after `submit_boq_bid`, an `update` on the bidder's `boq_bid_items` is rejected by RLS.

Use the seed helpers already at the top of `rls_security.sql`; add one tender, two bidders, and a couple of bid items in the fixture section.

- [ ] **Step 2: Run the suite**

Local: `supabase db reset` (replays all migrations) then `psql "$DB_URL" -f supabase/tests/rls_security.sql`. Expected: all `ASSERT`s pass (script exits 0). This is also what the CI `db-security` job runs.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/rls_security.sql
git commit -m "test(tender): RLS assertions — seal gate, bidder isolation, tenant isolation, submit lock"
```

---

## Task 4: Shared domain types

**Files:**
- Create: `packages/shared/src/domain/tender.ts`
- Modify: `packages/shared/src/domain/index.ts` (add `export * from './tender';`)
- Modify: `packages/shared/src/validation/index.ts` (add schemas)

- [ ] **Step 1: Domain enums + labels** (`tender.ts`) — mirror `boq.ts`:

```ts
export const TENDER_STATUSES = ['draft', 'open', 'closed', 'awarded', 'cancelled'] as const;
export type TenderStatus = (typeof TENDER_STATUSES)[number];
export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  draft: 'Draft', open: 'Open for bids', closed: 'Closed', awarded: 'Awarded', cancelled: 'Cancelled',
};
export const BIDDER_STATUSES = ['invited', 'viewing', 'submitted', 'withdrawn'] as const;
export type BidderStatus = (typeof BIDDER_STATUSES)[number];
export const BIDDER_STATUS_LABELS: Record<BidderStatus, string> = {
  invited: 'Invited', viewing: 'Viewing', submitted: 'Submitted', withdrawn: 'Withdrawn',
};
```

- [ ] **Step 2: Zod schemas** (`validation/index.ts`):

```ts
export const createTenderSchema = z.object({
  boqId: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  closeAt: z.string().datetime().optional().nullable(),
});
export const inviteBidderSchema = z.object({
  tenderId: z.string().uuid(),
  companyName: z.string().trim().min(2).max(160),
  email: z.string().trim().email(),
  userId: z.string().uuid().optional().nullable(),
});
export const saveBidRateSchema = z.object({
  token: z.string().min(10),
  boqItemId: z.string().uuid(),
  rateCents: z.number().int().min(0),
  noBid: z.boolean().optional(),
  note: z.string().trim().max(500).optional().nullable(),
});
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/shared
git add packages/shared/src/domain/tender.ts packages/shared/src/domain/index.ts packages/shared/src/validation/index.ts
git commit -m "feat(tender): shared statuses, labels, and zod schemas"
```

---

## Task 5: Data layer

**Files:**
- Create: `apps/web/lib/data/tender.ts`

- [ ] **Step 1: Implement reads** (mirror `lib/data/boq.ts` numeric-coercion + typing style). Functions:

- `getTenderForOwner(orgId, boqId)` → latest tender for the BOQ + bidders (from `boq_bidders`) with `status`, `submitted_at`; **no prices**. Uses the authed server client (RLS scopes it).
- `getBidWorkspace(token)` → for the signed-in bidder: resolves their `boq_bidders` row by token (RLS `boq_bidders_self_read`), the tender header, the bill lines via `supabase.rpc('tender_bill_lines', { p_tender_id })`, and their existing `boq_bid_items`. Returns `{ tender, bidder, lines, myRates }`.
- `listBidderTotals(...)` → **Phase 2** (post-unseal). Add a stub comment only; do not implement.

Types: `OwnerTenderView`, `BidWorkspace`, `BidLine` (section grouping like `BoqDetail`). Coerce `qty`/`rate_cents` through the `n()` helper from `boq.ts` (re-declare locally; do not import a non-exported symbol).

- [ ] **Step 2: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/web
git add apps/web/lib/data/tender.ts
git commit -m "feat(tender): data layer — owner tender view + bidder pricing workspace"
```

---

## Task 6: Owner-side server actions + dashboard

**Files:**
- Create: `apps/web/app/(app)/boq/[boqId]/tender/actions.ts`
- Create: `apps/web/app/(app)/boq/[boqId]/tender/page.tsx`
- Create: `apps/web/app/(app)/boq/[boqId]/tender/bidders-panel.tsx`
- Modify: `apps/web/app/(app)/boq/[boqId]/boq-builder.tsx` (add entry button)

- [ ] **Step 1: Actions** (mirror `boq/actions.ts` `requireOrg()` + `revalidatePath`):
  - `createTender(prev, formData)` → validate with `createTenderSchema`, call `supabase.rpc('create_tender', …)`, `revalidatePath`, redirect to the tender page.
  - `inviteBidder(prev, formData)` → validate with `inviteBidderSchema`, `supabase.rpc('invite_boq_bidder', …)` → returns `{ bidder_id, token }` → send the invite email (see Task 7) → `revalidatePath`.
  - `resendBidInvite(formData)` / `revokeBidder(formData)` → update `boq_bidders` (RLS staff policy) + (resend) re-send email.
  - `closeTender(formData)` → `update boq_tenders set status='closed'` (RLS staff). Unseal + award are **Phase 2** — do not add here.

- [ ] **Step 2: Dashboard page** (server component): auth + `getActiveContext` guard (mirror `boq/[boqId]/page.tsx`), load `getTenderForOwner`. If no tender: show a "Put out to tender" form (title + optional deadline) posting `createTender`. If a tender exists: render `<BiddersPanel />` with the invite form + bidder rows (company, email, status badge, submitted time) — **prices never shown here** (Phase 2 shows them post-unseal).

- [ ] **Step 3: BiddersPanel client component** — invite form with a toggle: "From contractors" (select existing `member_type='contractor'` members — fetch via a small server action or pass as props from the page) vs "New by email" (company + email). Lists bidders with status + resend/revoke buttons. Follow `org/members` client patterns.

- [ ] **Step 4: Entry button** in `boq-builder.tsx` header (next to Import/Duplicate), `canEdit` only: `<Link href={`/boq/${boq.id}/tender`}><Button size="sm">Put out to tender</Button></Link>`.

- [ ] **Step 5: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/web
git add "apps/web/app/(app)/boq/[boqId]/tender" "apps/web/app/(app)/boq/[boqId]/boq-builder.tsx"
git commit -m "feat(tender): owner dashboard — create tender, invite bidders, statuses"
```

---

## Task 7: Bidder invite email

**Files:**
- Modify: `apps/web/app/(app)/boq/[boqId]/tender/actions.ts` (wire email into `inviteBidder`/`resendBidInvite`)
- Create (optional): `apps/web/lib/email/tender-invite.ts` (subject + html builder, mirroring the `inviteEmail` helper used in `org/members/actions.ts`)

- [ ] **Step 1:** Build `tenderInviteEmail({ orgName, tenderTitle, companyName, acceptUrl })` returning `{ subject, html }`. `acceptUrl = ${window? no}` — server-side: use `${appUrl()}/tender/${token}` (reuse the existing `appUrl()` helper pattern; NOTE the app builds server links from `NEXT_PUBLIC_APP_URL` via `appUrl()` — keep using it for emails).
- [ ] **Step 2:** In `inviteBidder`, after the RPC returns the token, `await sendEmail({ to: email, subject, html })` inside a best-effort `try/catch` that rethrows `NEXT_REDIRECT` (mirror `resendInvitation` in `org/members/actions.ts`).
- [ ] **Step 3: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/web
git add "apps/web/app/(app)/boq/[boqId]/tender/actions.ts" apps/web/lib/email/tender-invite.ts
git commit -m "feat(tender): email bidders their sealed-bid invite link"
```

---

## Task 8: Bidder pricing screen

**Files:**
- Create: `apps/web/app/tender/[token]/page.tsx`
- Create: `apps/web/app/tender/[token]/bid-workspace.tsx`
- Create: `apps/web/app/tender/[token]/actions.ts`
- Modify: `apps/web/middleware.ts` (add `/tender` to `protectedPrefixes`)

- [ ] **Step 1: Middleware** — add `'/tender',` to the `protectedPrefixes` array (alphabetical, near `/support`). Bidder pages require a session; unauth → `/sign-in?next=/tender/<token>`.

- [ ] **Step 2: Entry page** (server component): auth guard → if no user, `redirect('/sign-in?next=' + encodeURIComponent('/tender/' + token))`. Call `supabase.rpc('accept_boq_bid_invite', { p_token: token })`; on the "different email" error, render a friendly "this invite was sent to X — sign in as that address" card (mirror `invite/[token]/page.tsx`). On success, `getBidWorkspace(token)` and render `<BidWorkspace />`.

- [ ] **Step 3: BidWorkspace client** — grid mirroring `boq-builder`'s `SectionRows`, but columns: **Item No · Description · Unit · Qty · Your rate (editable) · Your total**. No budget column. On rate blur → `saveBidRate` (server action → upsert `boq_bid_items` via the authed client; RLS bidder-RW policy permits it). Show live per-section + grand totals. A **Submit bid** button (confirm dialog) calls `submitBid` → `supabase.rpc('submit_boq_bid', { p_bidder_id })`; after submit, render read-only with a "Submitted ✓" banner. Respect `close_at`: if past, disable inputs and show "Tender closed".

- [ ] **Step 4: Bidder actions** (`actions.ts`): `saveBidRate(formData)` (validate `saveBidRateSchema`, upsert by `(bidder_id, boq_item_id)`), `submitBid(formData)` (call the RPC). Resolve `bidder_id` server-side via `my_bidder_id`/the token — never trust a client-supplied bidder id.

- [ ] **Step 5: Verify + commit**

```bash
pnpm turbo run typecheck lint --filter=@datumpro/web
git add apps/web/app/tender apps/web/middleware.ts
git commit -m "feat(tender): bidder sealed pricing screen — accept invite, price the bill, submit"
```

---

## Task 9: End-to-end verification (staging/prod DB simulation) + docs

- [ ] **Step 1: DB simulation (rolled back)** via the Supabase MCP: as an org admin, `create_tender` on a real BOQ; `invite_boq_bidder` for (a) an existing contractor member and (b) a new email. As bidder A (set claims to their user_id), `accept_boq_bid_invite`, upsert a couple of `boq_bid_items`, `submit_boq_bid`. Assert: admin `select boq_bid_items` = 0 rows (sealed); set `unsealed_at`; admin now sees them. Roll back.
- [ ] **Step 2: get_advisors** (security) after the DDL — confirm the 3 new tables report RLS enabled, no new criticals.
- [ ] **Step 3: Update** `docs/superpowers/specs/2026-08-09-boq-sealed-tender-design.md` status line: Phase 1 shipped; Phase 2 (unseal + comparison matrix + award) is the next plan.
- [ ] **Step 4:** Commit; merge to `main`; confirm the Vercel deploy reaches READY and `/tender/<token>` redirects unauth → `/sign-in` (route builds).

---

## Self-Review notes
- **Spec coverage:** invite existing+new (Task 6 §3 + Task 2 `invite_boq_bidder` w/ `p_user_id`); soft-seal (Task 2 `boq_bid_items_staff_read` gate + Task 3 assertion 1); budget rate never exposed (Task 2 `tender_bill_lines` view); bidder self-only (Task 2 policies + Task 3 assertion 2); submit lock (Task 2 RW policy `status in ('invited','viewing')` + Task 3 assertion 4); deadline (RPC `submit_boq_bid`). Phase 2 (unseal/compare/award) intentionally excluded.
- **RLS-on-RETURNING** avoided via `create_tender` / `invite_boq_bidder` SECURITY DEFINER RPCs (lesson from `create_organization`).
- **Bidders aren't org members:** all bidder access is via `is_tender_bidder`/`my_bidder_id` + `boq_bidders.user_id`, never `is_org_member`.
