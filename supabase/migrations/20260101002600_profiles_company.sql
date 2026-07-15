-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — profile company name
--
-- People (especially contractors) belong to a company. Surface it next to their
-- name across the app instead of a bare email. Self-editable via the existing
-- profiles UPDATE policy (a user may update their own row).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists company text;
