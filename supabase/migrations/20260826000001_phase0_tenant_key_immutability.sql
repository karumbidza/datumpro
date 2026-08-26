-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — Phase 0B: tenant identity (org_id) is immutable after creation
--
-- Tenant isolation is already strong (org_id on every tenant row + composite
-- (id, org_id) FKs + RLS). This adds a second invariant: once a tenant-owned row
-- exists, its org_id can never move to another organisation. This removes an
-- entire class of authorization-confusion / tenant-escape attempts such as:
--
--     UPDATE <table> SET org_id = '<another org>' WHERE id = '<mine>'
--
-- even by an otherwise-authorized user, and even by the service role (a trigger
-- is not bypassed by BYPASSRLS).
--
-- Design choice (safer than the literal "OLD.org_id IS DISTINCT FROM NEW.org_id"):
-- we reject a change only when org_id is ALREADY set (OLD.org_id IS NOT NULL).
-- This preserves any legitimate late-binding of a nullable org_id (null → value)
-- while making an established tenant key permanently immutable, and it blocks
-- clearing an established key (value → null) and moving it (value → other value).
-- For the many NOT NULL org_id tables this is exactly strict immutability.
--
-- project_id immutability is intentionally NOT added here (some resources may
-- legitimately move between projects). It is flagged as a follow-up in the review.
--
-- Migration-only exception: there is deliberately NO runtime/application escape
-- hatch. A future data migration that must relocate a row should
-- `ALTER TABLE ... DISABLE TRIGGER trg_immutable_org_id` for its scope and
-- re-enable it — an explicit, auditable, superuser-only act.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Guard function (no elevated rights needed; reads only OLD/NEW) ────────────
create or replace function public.guard_immutable_org_id()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.org_id is not null
     and new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable (tenant identity cannot change) on table %',
      tg_table_name
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_immutable_org_id() from public;

-- ── Explicit, auditable installation across every tenant-owned base table ─────
-- We discover the exact set from the live catalogue (any public BASE TABLE with an
-- `org_id` column), so the boundary self-corrects for dropped tables (e.g. the
-- legacy `invitations`) and never falsely includes `organizations` (whose tenant
-- key is `id`, not `org_id`). Each installation is logged via RAISE NOTICE so the
-- applied set is visible/auditable in the migration output.
--
-- `excluded` is intentionally empty: the null-aware rule above makes per-table
-- exclusion unnecessary (late-bound nullable org_id keeps working). Populate it
-- only if a genuinely cross-tenant/global table with an org_id column is ever
-- introduced.
do $$
declare
  r        record;
  excluded text[] := array[]::text[];
  n        int := 0;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name  = c.table_name
    where c.table_schema = 'public'
      and c.column_name  = 'org_id'
      and t.table_type   = 'BASE TABLE'
      and c.table_name <> all (excluded)
    order by c.table_name
  loop
    execute format(
      'drop trigger if exists trg_immutable_org_id on public.%I', r.table_name);
    execute format(
      'create trigger trg_immutable_org_id before update on public.%I '
      || 'for each row execute function public.guard_immutable_org_id()',
      r.table_name);
    raise notice 'Phase 0B: org_id immutability trigger installed on public.%',
      r.table_name;
    n := n + 1;
  end loop;
  raise notice 'Phase 0B: installed org_id immutability on % table(s).', n;
end $$;
