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

create policy "project-media read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-media'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "project-media upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "project-media delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-media'
    and public.org_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'pm')
  );
