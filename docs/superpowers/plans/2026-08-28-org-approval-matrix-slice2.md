# Org Approval Matrix (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single org-wide "second approver" dropdown with a per-entity-type **approval matrix** — for each thing that needs sign-off (task plan, variation, extension, payment, request) an admin sets an ordered chain of approver **roles** after the PM, plus an optional **amount threshold** above which the extra approvals apply.

**Architecture:** No schema change — the `approval_policies` table already has `entity_type`, `step_order`, `approver_role`, `min_amount_cents`. Add one SECURITY DEFINER RPC `set_org_approval_matrix(p_org_id, p_rows jsonb)` that replaces the org's policy rows from a per-entity-type config (step 1 = PM everywhere; steps 2..N = the configured roles at the threshold). A reader + server action + a matrix UI in the Policies tab replace the old uniform setter in the UI (the old `set_org_approval_policy` RPC stays for backward compatibility). The seed/enforce/finalize engine is untouched — richer policies just take effect.

**Tech Stack:** Supabase Postgres (plpgsql, jsonb), Next.js server component + server action, Tailwind. psql regression test in `supabase/tests/`.

**Spec:** `docs/superpowers/specs/2026-08-28-org-member-management-and-approval-matrix-design.md` (Slice 2 section).

**Testing:** The RPC gets a real psql regression suite (`supabase/tests/approval_matrix.sql`, run against the local stack). Frontend gate is `pnpm -C apps/web typecheck` + eslint (no component-test harness). Do NOT `git add -A`/`.`; stage only named files. Ignore pre-existing type errors in untracked `apps/web/app/api/admin/{analytics,flags,logs}/`.

**Deploy note:** This slice adds a migration → after merge it needs `supabase db push` (a human-authorized step). It is inert until pushed; the app falls back to the existing rows.

---

## File Structure

- **Create** `supabase/migrations/20260826000017_org_approval_matrix.sql` — the `set_org_approval_matrix` RPC.
- **Create** `supabase/tests/approval_matrix.sql` — psql regression suite for the RPC (picked up by the existing per-file test loop / `rls_security` job).
- **Modify** `apps/web/lib/data/approvals.ts` — add `getOrgApprovalMatrix(orgId)` reader.
- **Modify** `apps/web/app/(app)/org/actions.ts` — add `setApprovalMatrix` server action.
- **Create** `apps/web/components/org/approval-matrix.tsx` — the matrix table form (server component).
- **Modify** `apps/web/app/(app)/org/page.tsx` — Policies tab renders `<ApprovalMatrix>`; fetch `getOrgApprovalMatrix` instead of `getOrgSecondApprover`.

---

### Task 1: `set_org_approval_matrix` RPC

**Files:**
- Create: `supabase/migrations/20260826000017_org_approval_matrix.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — configurable approval matrix.
--
-- Generalises set_org_approval_policy (uniform PM→role) to a per-entity-type
-- chain: step 1 is always PM; steps 2..N are the configured roles, applied only
-- when the entity amount meets min_amount_cents. Role-based approvers only — no
-- schema change (approval_policies already has entity_type/step_order/
-- approver_role/min_amount_cents). set_org_approval_policy is left in place.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_org_approval_matrix(p_org_id uuid, p_rows jsonb)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  et         text;
  v_row      jsonb;
  extra_role text;
  v_step     int;
  v_threshold bigint;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Only an org owner or admin can change the approval policy';
  end if;

  delete from public.approval_policies where org_id = p_org_id;

  -- Invariant: every entity type keeps a PM step 1 at zero threshold (covers the
  -- retired 'variation' type too, so nothing is left without a first step).
  foreach et in array array['request', 'extension', 'payment', 'task_plan', 'task_variation', 'variation']
  loop
    insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
    values (p_org_id, et, 1, 'pm', 0);
  end loop;

  -- Extra approver steps (2..N) per configured entity type, at the threshold.
  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as t(value)
  loop
    et := v_row ->> 'entity_type';
    if et is null then continue; end if;
    v_threshold := coalesce((v_row ->> 'min_amount_cents')::bigint, 0);
    v_step := 2;
    for extra_role in select value from jsonb_array_elements_text(coalesce(v_row -> 'extra_roles', '[]'::jsonb)) as t(value)
    loop
      if extra_role is not null and extra_role <> 'none' and extra_role <> '' then
        insert into public.approval_policies (org_id, entity_type, step_order, approver_role, min_amount_cents)
        values (p_org_id, et, v_step, extra_role::public.org_role, v_threshold);
        v_step := v_step + 1;
      end if;
    end loop;
  end loop;
end;
$function$;

revoke all on function public.set_org_approval_matrix(uuid, jsonb) from public;
grant execute on function public.set_org_approval_matrix(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Apply it to the local stack**

Run: `supabase db reset` (or `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20260826000017_org_approval_matrix.sql`)
Expected: `CREATE FUNCTION` / migration applies with no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260826000017_org_approval_matrix.sql
git commit -m "feat(approvals): set_org_approval_matrix RPC (per-entity-type role chains + thresholds)"
```

---

### Task 2: psql regression suite for the RPC

**Files:**
- Create: `supabase/tests/approval_matrix.sql`

- [ ] **Step 1: Write the test** (same harness/style as the other `supabase/tests/*.sql`: one rolled-back transaction, `pg_temp.ok`)

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — approval matrix regression (set_org_approval_matrix).
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/approval_matrix.sql
-- ─────────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS: %', label; else raise exception 'FAIL: %', label; end if; end $$;

-- Org + an admin (owner) and a non-admin member.
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'am-owner@test.dev'),
  ('d0000000-0000-0000-0000-000000000002', 'am-member@test.dev');
insert into public.organizations (id, name) values ('d1110000-0000-0000-0000-000000000000', 'AM Org');
insert into public.org_members (org_id, user_id, role, member_type, status) values
  ('d1110000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000001', 'owner', 'owner', 'active'),
  ('d1110000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000002', 'member', 'staff', 'active');

-- Configure: payment needs PM → Finance → Admin above $5,000; everything else PM-only.
set role authenticated;
set request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select public.set_org_approval_matrix(
  'd1110000-0000-0000-0000-000000000000',
  '[{"entity_type":"payment","extra_roles":["finance","admin"],"min_amount_cents":500000}]'::jsonb);
reset role; reset request.jwt.claims;

select pg_temp.ok(
  (select count(*) from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='payment') = 3,
  '1: payment has 3 steps (PM + finance + admin)');
select pg_temp.ok(
  (select approver_role::text from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='payment' and step_order=1) = 'pm',
  '2: payment step 1 is PM at threshold 0');
select pg_temp.ok(
  (select array_agg(approver_role::text order by step_order) from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='payment' and step_order>=2)
    = array['finance','admin'],
  '3: payment steps 2..3 are finance then admin');
select pg_temp.ok(
  (select bool_and(min_amount_cents=500000) from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='payment' and step_order>=2),
  '4: payment extra steps carry the $5,000 threshold');
select pg_temp.ok(
  (select count(*) from public.approval_policies
     where org_id='d1110000-0000-0000-0000-000000000000' and entity_type='task_plan') = 1,
  '5: an unconfigured entity type keeps PM-only (step 1)');

-- seed_approval_steps materialises the configured chain for an above-threshold entity.
select pg_temp.ok(
  (select count(*) from (
     select public.seed_approval_steps('payment', 'd2220000-0000-0000-0000-000000000000',
       'd1110000-0000-0000-0000-000000000000', 600000)) s
     ) >= 0,  -- call succeeds
  '6: seed_approval_steps runs for a payment');
select pg_temp.ok(
  (select count(*) from public.approvals
     where org_id='d1110000-0000-0000-0000-000000000000'
       and entity_type='payment' and entity_id='d2220000-0000-0000-0000-000000000000') = 3,
  '7: a $6,000 payment seeds the full 3-step chain');

-- A non-admin cannot change the matrix.
set role authenticated;
set request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}';
do $$
begin
  perform public.set_org_approval_matrix('d1110000-0000-0000-0000-000000000000', '[]'::jsonb);
  raise exception 'FAIL: 8: a non-admin changed the approval matrix';
exception when others then
  if position('owner or admin' in SQLERRM) > 0 then raise notice 'PASS: 8: non-admin rejected.';
  else raise; end if;
end $$;
reset role; reset request.jwt.claims;

rollback;

\echo '────────────────────────────────────────────'
\echo 'All approval-matrix checks passed.'
\echo '────────────────────────────────────────────'
```

- [ ] **Step 2: Run it against the local stack**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/approval_matrix.sql`
Expected: every `PASS:` line, ends with "All approval-matrix checks passed." exit 0.
(If step 6/7 fail because `seed_approval_steps`' signature differs, open the function in `supabase/migrations/*approval_engine*.sql`, match its real argument order/names, and adjust the call. If a guard trigger blocks the `approvals` insert, note it — but seeding is a SECURITY DEFINER path so it should be fine.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/approval_matrix.sql
git commit -m "test(approvals): set_org_approval_matrix regression suite"
```

---

### Task 3: Reader + server action

**Files:**
- Modify: `apps/web/lib/data/approvals.ts`
- Modify: `apps/web/app/(app)/org/actions.ts`

- [ ] **Step 1: Add the reader** to `apps/web/lib/data/approvals.ts` (keep `getOrgSecondApprover` for now)

```ts
export interface ApprovalMatrixRow {
  entityType: string;
  extraRoles: string[]; // approver roles for steps 2..N, in order
  minAmountCents: number; // threshold above which the extra steps apply
}

/** Current per-entity-type approval chains (steps 2..N + threshold). Step 1 is
 *  always PM and is not returned. */
export async function getOrgApprovalMatrix(orgId: string): Promise<ApprovalMatrixRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('approval_policies')
    .select('entity_type, step_order, approver_role, min_amount_cents')
    .eq('org_id', orgId)
    .order('entity_type', { ascending: true })
    .order('step_order', { ascending: true });
  const rows = (data ?? []) as { entity_type: string; step_order: number; approver_role: string; min_amount_cents: number }[];
  const byType = new Map<string, ApprovalMatrixRow>();
  for (const r of rows) {
    let m = byType.get(r.entity_type);
    if (!m) { m = { entityType: r.entity_type, extraRoles: [], minAmountCents: 0 }; byType.set(r.entity_type, m); }
    if (r.step_order >= 2) { m.extraRoles.push(r.approver_role); m.minAmountCents = r.min_amount_cents; }
  }
  return [...byType.values()];
}
```

- [ ] **Step 2: Add the action** to `apps/web/app/(app)/org/actions.ts` (near `setApprovalPolicy`; reuse the file's existing `createClient`/`logAudit`/`revalidatePath`/`redirect` imports)

```ts
const MATRIX_ENTITY_TYPES = ['task_plan', 'task_variation', 'extension', 'payment', 'request'] as const;

/** Set the per-entity-type approval matrix (role chains + thresholds). Step 1 is
 *  always PM. RPC is SECURITY DEFINER and re-checks org-admin. */
export async function setApprovalMatrix(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (!orgId) throw new Error('Missing organisation');

  const rows = MATRIX_ENTITY_TYPES.map((et) => {
    const extra_roles = [String(formData.get(`${et}_step2`) ?? 'none'), String(formData.get(`${et}_step3`) ?? 'none')]
      .filter((r) => r && r !== 'none');
    const dollars = Number(formData.get(`${et}_threshold`) ?? 0);
    const min_amount_cents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
    return { entity_type: et, extra_roles, min_amount_cents };
  });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.rpc('set_org_approval_matrix', { p_org_id: orgId, p_rows: rows });
  if (error) throw new Error(error.message);

  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'approval_matrix.set', after: { rows } });
  revalidatePath('/org');
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint lib/data/approvals.ts "app/(app)/org/actions.ts"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/data/approvals.ts "apps/web/app/(app)/org/actions.ts"
git commit -m "feat(approvals): getOrgApprovalMatrix reader + setApprovalMatrix action"
```

---

### Task 4: Approval-matrix UI component

**Files:**
- Create: `apps/web/components/org/approval-matrix.tsx`

- [ ] **Step 1: Create the component** (server component — a single form of selects; no client JS)

```tsx
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { setApprovalMatrix } from '@/app/(app)/org/actions';
import type { ApprovalMatrixRow } from '@/lib/data/approvals';

const ENTITIES: { key: string; label: string }[] = [
  { key: 'task_plan', label: 'Task plan' },
  { key: 'task_variation', label: 'Variation' },
  { key: 'extension', label: 'Extension' },
  { key: 'payment', label: 'Payment' },
  { key: 'request', label: 'Request' },
];
const ROLE_OPTIONS = ['none', 'pm', 'finance', 'admin', 'viewer'] as const;
const ROLE_LABEL: Record<string, string> = { none: 'None', pm: 'Another PM', finance: 'Finance', admin: 'Admin', viewer: 'Viewer' };
const selectClass = 'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

function RoleSelect({ name, value }: { name: string; value: string }) {
  return (
    <select name={name} defaultValue={value} className={selectClass}>
      {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </select>
  );
}

export function ApprovalMatrix({ orgId, matrix }: { orgId: string; matrix: ApprovalMatrixRow[] }) {
  const byType = new Map(matrix.map((m) => [m.entityType, m]));
  return (
    <Card>
      <CardTitle>Approval matrix</CardTitle>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Everything that needs sign-off goes to the <span className="font-medium text-zinc-700 dark:text-zinc-300">project
        manager first</span>. Add up to two more approvers (by role) per type, and an optional amount above which the extra
        approvals kick in.
      </p>
      <form action={setApprovalMatrix} className="mt-3 overflow-x-auto">
        <input type="hidden" name="orgId" value={orgId} />
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th className="py-1 pr-3 font-medium">Needs sign-off</th>
              <th className="py-1 pr-3 font-medium">1st</th>
              <th className="py-1 pr-3 font-medium">2nd</th>
              <th className="py-1 pr-3 font-medium">3rd</th>
              <th className="py-1 font-medium">Threshold ($)</th>
            </tr>
          </thead>
          <tbody>
            {ENTITIES.map(({ key, label }) => {
              const row = byType.get(key);
              const step2 = row?.extraRoles[0] ?? 'none';
              const step3 = row?.extraRoles[1] ?? 'none';
              const threshold = row && row.minAmountCents > 0 ? Math.round(row.minAmountCents / 100) : '';
              return (
                <tr key={key} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3 font-medium text-zinc-800 dark:text-zinc-200">{label}</td>
                  <td className="py-2 pr-3 text-xs text-zinc-500 dark:text-zinc-400">PM</td>
                  <td className="py-2 pr-3"><RoleSelect name={`${key}_step2`} value={step2} /></td>
                  <td className="py-2 pr-3"><RoleSelect name={`${key}_step3`} value={step3} /></td>
                  <td className="py-2">
                    <input
                      type="number" min={0} step={100} name={`${key}_threshold`} defaultValue={threshold}
                      placeholder="0"
                      className={`w-24 ${selectClass}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3">
          <Button type="submit">Save matrix</Button>
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint components/org/approval-matrix.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/org/approval-matrix.tsx
git commit -m "feat(org): approval-matrix table component"
```

---

### Task 5: Wire the matrix into the Policies tab

**Files:**
- Modify: `apps/web/app/(app)/org/page.tsx`

- [ ] **Step 1: Swap the reader** — replace `getOrgSecondApprover` with `getOrgApprovalMatrix`:
  - Update the import: `import { getOrgApprovalMatrix } from '@/lib/data/approvals';` (remove the `getOrgSecondApprover` import).
  - Add `import { ApprovalMatrix } from '@/components/org/approval-matrix';`.
  - In the `Promise.all`, replace `getOrgSecondApprover(orgId)` with `getOrgApprovalMatrix(orgId)` and rename the destructured var `secondApprover` → `approvalMatrix`.

- [ ] **Step 2: Replace the Policies tab body** — swap the old single-dropdown `Card` for the matrix:

```tsx
{activeTab === 'policies' && <ApprovalMatrix orgId={orgId} matrix={approvalMatrix} />}
```

(Delete the entire previous `activeTab === 'policies'` `<Card>…setApprovalPolicy…</Card>` block. Remove the now-unused `setApprovalPolicy` import if nothing else in the file uses it.)

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec eslint "app/(app)/org/page.tsx"`
Expected: clean, no unused imports.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/org/page.tsx"
git commit -m "feat(org): Policies tab renders the approval matrix"
```

---

### Task 6: Full verification + PR

- [ ] **Step 1: Full checks**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/approval_matrix.sql` (all PASS) then `pnpm -C apps/web typecheck` (clean, ignoring untracked admin files) then `pnpm -C apps/web exec eslint "app/(app)/org" "components/org" "lib/data/approvals.ts"` (clean).

- [ ] **Step 2: Full db reset replays in order**

Run: `supabase db reset` — expected: applies `20260826000017_org_approval_matrix.sql` with no error.

- [ ] **Step 3: Manual static self-review**
  - Policies tab shows the matrix (5 rows; PM fixed as 1st; 2nd/3rd role selects; threshold input).
  - Defaults reflect the current `approval_policies` (a fresh org shows PM-only rows).
  - Saving posts `<et>_step2/_step3/_threshold` for each entity type → `setApprovalMatrix` → RPC.

- [ ] **Step 4: Push + PR** (controller does this — implementer stops here)

---

## Self-review checklist (author)

- **Spec coverage:** per-entity-type matrix ✅ (Task 4), ordered role chain ✅, amount threshold ✅, new `set_org_approval_matrix` RPC with no schema change ✅ (Task 1), step 1 = PM ✅ (RPC invariant), approvers role-based ✅, psql test ✅ (Task 2). `set_org_approval_policy` kept ✅ (Task 1 leaves it).
- **Types:** `ApprovalMatrixRow` defined in Task 3, consumed in Task 4/5. `setApprovalMatrix` defined Task 3, used Task 4. `MATRIX_ENTITY_TYPES` (action) and `ENTITIES` (UI) both list the same 5 live types.
- **No placeholders:** all code present; the only "confirm the real signature" is `seed_approval_steps` in Task 2 Step 2 (explicit verify instruction).

## Notes for the implementer
- **`seed_approval_steps` signature:** confirm arg order/names before Task 2 Step 2 (grep `create or replace function public.seed_approval_steps` in `supabase/migrations`). Adjust the test call to match.
- **`org_role` values:** the role cast in the RPC accepts `pm/finance/admin/viewer/owner/member`. The UI only offers `pm/finance/admin/viewer` + `none`; keep those in sync.
- **Backward compat:** `getOrgSecondApprover` may still be imported elsewhere — only remove its import from `page.tsx`, leave the exported function.
