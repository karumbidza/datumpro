-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project setup fields, code generation, derived end date (Phase 1)
--
-- Reconciliation with the repo (repo pattern wins):
--  · Money stays as contract_value_cents (bigint, exact) — NOT a parallel numeric.
--  · PM stays in project_members (role 'pm') — no manager_id column.
--  · Planned end reuses projects.end_date (Gantt/portfolio already read it).
--  · Existing generic project_type is UNTOUCHED; construction work-type goes in a
--    new nullable construction_type column.
-- All new columns are nullable or defaulted so existing rows stay valid.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.project_construction_type as enum
  ('new_build', 'renovation', 'fit_out', 'civils', 'mep', 'maintenance', 'other');

alter table public.projects
  add column construction_type    public.project_construction_type,
  add column currency             char(3) not null default 'USD',
  add column calendar_id          uuid references public.work_calendars(id) on delete set null,
  add column duration_working_days int,
  add column retention_pct        numeric(5,2),
  add column payment_terms_days   int,
  add column latitude             numeric(9,6),
  add column longitude            numeric(9,6),
  add column client_visibility    jsonb not null default
    '{"schedule":true,"tasks":true,"photos":true,"documents":true,"rfis":true,"variations":true,"valuations":true,"cost_budget":false,"margin":false,"subcontractor_rates":false,"internal_notes":false}'::jsonb;

alter table public.projects
  add constraint projects_currency_chk check (currency in ('USD', 'ZWG')),
  add constraint projects_retention_chk check (retention_pct is null or (retention_pct >= 0 and retention_pct <= 100)),
  add constraint projects_contract_value_chk check (contract_value_cents >= 0),
  add constraint projects_end_after_start_chk check (start_date is null or end_date is null or end_date >= start_date);

-- ── Backfill existing rows: default calendar + generated codes ──
update public.projects p
set calendar_id = c.id
from public.work_calendars c
where c.org_id = p.org_id and c.is_default and p.calendar_id is null;

-- Codes: DP-YYYY-NNN, per org per year, ordered by creation. Safe here because no
-- existing project currently has a code.
with numbered as (
  select id,
         to_char(coalesce(start_date, created_at::date), 'YYYY') as yr,
         row_number() over (
           partition by org_id, to_char(coalesce(start_date, created_at::date), 'YYYY')
           order by created_at
         ) as rn
  from public.projects
  where code is null or trim(code) = ''
)
update public.projects p
set code = 'DP-' || n.yr || '-' || lpad(n.rn::text, 3, '0')
from numbered n
where p.id = n.id;

create unique index projects_org_code_key on public.projects (org_id, code);

-- ── Server-side, collision-safe code allocation (BEFORE INSERT, per-org advisory
--    lock inside the txn). Explicit codes are respected and left immutable. ──
create or replace function public.assign_project_code()
  returns trigger language plpgsql security definer set search_path to ''
as $$
declare
  v_year text := to_char(coalesce(new.start_date, current_date), 'YYYY');
  v_seq  int;
begin
  if new.code is not null and trim(new.code) <> '' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('project_code:' || new.org_id::text || ':' || v_year));
  select coalesce(max((regexp_replace(code, '^DP-' || v_year || '-', ''))::int), 0) + 1
    into v_seq
    from public.projects
   where org_id = new.org_id and code like 'DP-' || v_year || '-%';
  new.code := 'DP-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  return new;
end $$;

create trigger on_project_assign_code
  before insert on public.projects
  for each row execute function public.assign_project_code();

-- ── Derived planned end date: end_date = add_working_days(start, duration, cal).
--    Same function the form previews over RPC → one source of truth. Only fires
--    when the driving columns are set/changed, so manual end dates aren't clobbered. ──
create or replace function public.derive_project_end_date()
  returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if new.start_date is not null and new.duration_working_days is not null and new.calendar_id is not null then
    new.end_date := public.add_working_days(new.start_date, new.duration_working_days, new.calendar_id, new.id);
  end if;
  return new;
end $$;

create trigger on_project_derive_end
  before insert or update of start_date, duration_working_days, calendar_id
  on public.projects
  for each row execute function public.derive_project_end_date();
