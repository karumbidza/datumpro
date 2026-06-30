-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — field monitoring: site reports + media
--
-- Offline-first tables (captured on site, synced via PowerSync). RLS lets any
-- active org member CREATE their own report/media; edits/deletes are restricted
-- to the author or delivery leads (pm/admin/owner).
--
-- Tenant-consistent references via composite FKs: site_reports → projects(id,
-- org_id); report_media → site_reports(id, org_id) AND projects(id, org_id).
-- ─────────────────────────────────────────────────────────────────────────────

create type public.report_status as enum ('draft', 'submitted');
create type public.media_type    as enum ('image', 'video');

create table public.site_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  -- nullable so we can keep the report (history) if the author is deleted
  author_id    uuid references auth.users(id) on delete set null,
  report_date  date not null default current_date,
  progress_pct smallint not null default 0 check (progress_pct between 0 and 100),
  narrative    text,
  weather      text,
  gps_lat      double precision,
  gps_lng      double precision,
  status       public.report_status not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index site_reports_project_idx on public.site_reports (project_id, report_date desc);
create index site_reports_org_idx     on public.site_reports (org_id);

create table public.report_media (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null,
  report_id    uuid not null,
  storage_path text not null,           -- {org_id}/{project_id}/{report_id}/{file}
  media_type   public.media_type not null,
  captured_at  timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  foreign key (report_id, org_id)   references public.site_reports (id, org_id) on delete cascade
);
create index report_media_report_idx on public.report_media (report_id);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger site_reports_touch
  before update on public.site_reports
  for each row execute function public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.site_reports enable row level security;
alter table public.report_media enable row level security;

create policy site_reports_select on public.site_reports for select
  using ((select public.is_org_member(org_id)));
create policy site_reports_insert on public.site_reports for insert
  with check ((select public.is_org_member(org_id)) and author_id = (select auth.uid()));
create policy site_reports_update on public.site_reports for update
  using (author_id = (select auth.uid()) or (select public.org_role(org_id)) in ('owner', 'admin', 'pm'))
  with check ((select public.is_org_member(org_id)));
create policy site_reports_delete on public.site_reports for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));

create policy report_media_select on public.report_media for select
  using ((select public.is_org_member(org_id)));
create policy report_media_insert on public.report_media for insert
  with check ((select public.is_org_member(org_id)));
create policy report_media_delete on public.report_media for delete
  using ((select public.org_role(org_id)) in ('owner', 'admin', 'pm'));
