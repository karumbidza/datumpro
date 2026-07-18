-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — working calendars, public holidays, add_working_days (Phase 1)
--
-- Durations are stored in working days; end dates are DERIVED via add_working_days
-- (the single source of truth — the create form calls it over RPC for live
-- feedback). Calendars are org-scoped (5-day default, 5.5-day, 6-day); holidays
-- are a global table keyed by country (ZW), because moving holidays like Heroes'
-- Day can't be a formula. Per-project calendar exceptions (rain days / EOT) land
-- in Phase 6 — the function keeps the p_project param now for a stable signature.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.work_calendars (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null,
  works_mon      boolean not null default true,
  works_tue      boolean not null default true,
  works_wed      boolean not null default true,
  works_thu      boolean not null default true,
  works_fri      boolean not null default true,
  works_sat      boolean not null default false,
  works_sun      boolean not null default false,
  saturday_hours numeric(4,2),
  hours_per_day  numeric(4,2) not null default 8,
  is_default     boolean not null default false,
  created_at     timestamptz not null default now()
);
create index work_calendars_org_idx on public.work_calendars (org_id);
create unique index work_calendars_one_default on public.work_calendars (org_id) where is_default;

alter table public.work_calendars enable row level security;
create policy work_calendars_select on public.work_calendars for select
  using ((select public.is_org_member(org_id)));
create policy work_calendars_write on public.work_calendars for all
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));

create table public.public_holidays (
  id                uuid primary key default gen_random_uuid(),
  country           char(2) not null default 'ZW',
  holiday_date      date not null,
  name              text not null,
  is_observed_shift boolean not null default false
);
create unique index public_holidays_country_date_key on public.public_holidays (country, holiday_date);

alter table public.public_holidays enable row level security;
-- Global reference data: any signed-in user may read; only the migration/service
-- role writes (no write policy).
create policy public_holidays_select on public.public_holidays for select
  using ((select auth.uid()) is not null);

-- ── Date maths: N working days after p_start on a calendar, skipping ZW holidays ──
create or replace function public.add_working_days(
  p_start    date,
  p_days     int,
  p_calendar uuid,
  p_project  uuid default null
) returns date
  language plpgsql stable security definer set search_path to ''
as $$
declare
  d       date := p_start;
  counted int := 0;
  cal     public.work_calendars%rowtype;
  works   boolean;
begin
  select * into cal from public.work_calendars where id = p_calendar;
  if not found then return null; end if;
  if p_days is null or p_days <= 0 then return p_start; end if;

  while counted < p_days loop
    d := d + 1;
    works := case extract(isodow from d)
      when 1 then cal.works_mon when 2 then cal.works_tue
      when 3 then cal.works_wed when 4 then cal.works_thu
      when 5 then cal.works_fri when 6 then cal.works_sat
      else cal.works_sun end;
    if works and exists (
      select 1 from public.public_holidays where holiday_date = d and country = 'ZW'
    ) then
      works := false;
    end if;
    -- Per-project calendar exceptions handled in Phase 6 (param kept for signature).
    if works then counted := counted + 1; end if;
  end loop;
  return d;
end $$;
grant execute on function public.add_working_days(date, int, uuid, uuid) to authenticated;

-- ── Seed the three calendars for existing orgs; new orgs get them via trigger ──
insert into public.work_calendars (org_id, name, works_sat, works_sun, saturday_hours, hours_per_day, is_default)
select o.id, v.name, v.works_sat, v.works_sun, v.saturday_hours, v.hours_per_day, v.is_default
from public.organizations o
cross join (values
  ('Standard 5-day',     false, false, null,        8.0, true),
  ('5.5-day (Sat half)', true,  false, 4.5,         8.0, false),
  ('6-day',              true,  false, 8.0,         8.0, false)
) as v(name, works_sat, works_sun, saturday_hours, hours_per_day, is_default);

create or replace function public.handle_new_org()
  returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if (select auth.uid()) is not null then
    insert into public.org_members (org_id, user_id, role, member_type, status)
    values (new.id, (select auth.uid()), 'owner', 'owner', 'active')
    on conflict (org_id, user_id) do nothing;
  end if;
  -- Seed the org's work calendars (5-day default, 5.5-day, 6-day).
  insert into public.work_calendars (org_id, name, works_sat, works_sun, saturday_hours, hours_per_day, is_default)
  values
    (new.id, 'Standard 5-day',     false, false, null, 8.0, true),
    (new.id, '5.5-day (Sat half)', true,  false, 4.5,  8.0, false),
    (new.id, '6-day',              true,  false, 8.0,  8.0, false);
  return new;
end;
$function$;

-- ── Seed Zimbabwe public holidays 2026–2028 (fixed + Easter + moving Heroes'/DFD;
--    Sunday→Monday observed shifts flagged). ──
insert into public.public_holidays (country, holiday_date, name, is_observed_shift) values
  ('ZW','2026-01-01','New Year''s Day',false),
  ('ZW','2026-04-03','Good Friday',false),
  ('ZW','2026-04-04','Easter Saturday',false),
  ('ZW','2026-04-06','Easter Monday',false),
  ('ZW','2026-04-18','Independence Day',false),
  ('ZW','2026-05-01','Workers'' Day',false),
  ('ZW','2026-05-25','Africa Day',false),
  ('ZW','2026-08-10','Heroes'' Day',false),
  ('ZW','2026-08-11','Defence Forces Day',false),
  ('ZW','2026-12-22','Unity Day',false),
  ('ZW','2026-12-25','Christmas Day',false),
  ('ZW','2026-12-26','Boxing Day',false),
  ('ZW','2027-01-01','New Year''s Day',false),
  ('ZW','2027-03-26','Good Friday',false),
  ('ZW','2027-03-27','Easter Saturday',false),
  ('ZW','2027-03-29','Easter Monday',false),
  ('ZW','2027-04-18','Independence Day',false),
  ('ZW','2027-04-19','Independence Day (observed)',true),
  ('ZW','2027-05-01','Workers'' Day',false),
  ('ZW','2027-05-25','Africa Day',false),
  ('ZW','2027-08-09','Heroes'' Day',false),
  ('ZW','2027-08-10','Defence Forces Day',false),
  ('ZW','2027-12-22','Unity Day',false),
  ('ZW','2027-12-25','Christmas Day',false),
  ('ZW','2027-12-26','Boxing Day',false),
  ('ZW','2027-12-27','Boxing Day (observed)',true),
  ('ZW','2028-01-01','New Year''s Day',false),
  ('ZW','2028-04-14','Good Friday',false),
  ('ZW','2028-04-15','Easter Saturday',false),
  ('ZW','2028-04-17','Easter Monday',false),
  ('ZW','2028-04-18','Independence Day',false),
  ('ZW','2028-05-01','Workers'' Day',false),
  ('ZW','2028-05-25','Africa Day',false),
  ('ZW','2028-08-14','Heroes'' Day',false),
  ('ZW','2028-08-15','Defence Forces Day',false),
  ('ZW','2028-12-22','Unity Day',false),
  ('ZW','2028-12-25','Christmas Day',false),
  ('ZW','2028-12-26','Boxing Day',false);
