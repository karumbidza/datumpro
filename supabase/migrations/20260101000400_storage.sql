-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — media storage bucket + access policies
--
-- Objects are keyed by a tenant path: {org_id}/{project_id}/{report_id}/{file}.
-- Access is granted by checking the FIRST path segment (org_id) against the
-- caller's org membership — same isolation model as the tables.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', false)
on conflict (id) do nothing;

-- Safe cast: a malformed object name would make a raw `::uuid` cast throw inside
-- the policy. Return null instead → membership checks simply fail closed.
create or replace function public.safe_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create policy "project-media read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.is_org_member(public.safe_uuid((storage.foldername(name))[1])))
  );

create policy "project-media upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and (select public.is_org_member(public.safe_uuid((storage.foldername(name))[1])))
  );

create policy "project-media delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.org_role(public.safe_uuid((storage.foldername(name))[1]))) in ('owner', 'admin', 'pm')
  );
