-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — profile phone number
--
-- The chat People rail surfaces a member's contact card (phone + email). Email
-- already lives on profiles; add an optional phone number. Self-editable only —
-- the existing profiles RLS (a user may update their own row) already covers it.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists phone text;
