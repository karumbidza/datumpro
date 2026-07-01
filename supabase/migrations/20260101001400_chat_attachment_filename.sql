-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — chat media: remember the original filename for document attachments
--
-- Phase 6 renders attachments inline. Images/video/audio are self-describing, but
-- a document chip needs the human name the uploader saw ("Foundation-RFI.pdf"),
-- which the storage key (a random uuid) deliberately does not carry. One nullable
-- column; RLS and denormalization already cover the row.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.message_attachments add column if not exists filename text;
