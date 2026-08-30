-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — "About Topic" for a project chat
--
-- The chat right-rail gets an editable About panel: what this conversation is
-- focused on (topic), a short description, and a pinned note. These are plain
-- optional text on the conversation; editing is gated by the existing
-- conversations_write RLS policy (org staff or the project PM), the same set the
-- app calls "canModerate".
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.conversations
  add column if not exists topic       text,
  add column if not exists description text,
  add column if not exists note        text;
