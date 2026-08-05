-- ─────────────────────────────────────────────────────────────────────────────
-- Security hardening (from the security assessment)
--
-- F4: constrain the public `avatars` bucket to image types and a small size, so
--     a user can't bypass the client-side resize and host arbitrary files under
--     the storage origin.
-- F5: add the missing WITH CHECK to org_domains_update so a row can't be updated
--     into a state the USING predicate wouldn't permit.
-- ─────────────────────────────────────────────────────────────────────────────

-- F4 — avatars bucket limits (5 MB; WebP/JPEG/PNG only). Idempotent update.
update storage.buckets
   set file_size_limit    = 5242880,                                  -- 5 MB
       allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id = 'avatars';

-- F5 — org_domains UPDATE was missing a WITH CHECK. Recreate with both sides
-- gated by is_org_admin so an admin can't move a row out of their own org.
drop policy if exists org_domains_update on public.org_domains;
create policy org_domains_update on public.org_domains for update
  using ((select public.is_org_admin(org_id)))
  with check ((select public.is_org_admin(org_id)));
