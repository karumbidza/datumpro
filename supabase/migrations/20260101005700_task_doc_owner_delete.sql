-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — let an uploader delete their own media object
--
-- Deleting a BoQ/invoice (or replacing it, or an award clearing losing bids)
-- should also remove the underlying storage object, not just the DB row. The
-- delete policy allowed managers + tender invitees; add the object's owner so a
-- contractor can clean up their own plan/bid uploads directly (esp. on mobile,
-- which acts with the user's session rather than the service role).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "project-media delete" on storage.objects;
create policy "project-media delete" on storage.objects for delete to authenticated using (
  bucket_id = 'project-media' and (
    owner = (select auth.uid())
    or (select public.can_manage_project(
          public.safe_uuid((storage.foldername(name))[2]), public.safe_uuid((storage.foldername(name))[1])))
    or (select public.is_tender_invitee(public.safe_uuid((storage.foldername(name))[4])))
  )
);
