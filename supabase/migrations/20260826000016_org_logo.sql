-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — organisation logo.
--
-- A public `org-logos` bucket (like `avatars`) holding one logo per org at
-- `{orgId}/logo`, plus a stored path + cache-bust timestamp on organizations.
-- Only an org admin may write/replace/remove their own org's logo; anyone signed
-- in can read (logos render without signed URLs). Modeled on the avatars policies
-- (20260101007600) but keyed on the org-id path segment via is_org_admin.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists logo_path       text,
  add column if not exists logo_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-logos', 'org-logos', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 2097152,
      allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

-- Public read.
create policy "org-logos read"
  on storage.objects for select to authenticated
  using (bucket_id = 'org-logos');

-- Admin-only write to the org's own folder. The first path segment is the org id
-- ({orgId}/logo); the regex guard keeps the ::uuid cast from erroring on a bad path.
create policy "org-logos write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

create policy "org-logos update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

create policy "org-logos delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );
