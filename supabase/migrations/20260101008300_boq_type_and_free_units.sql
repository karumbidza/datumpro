-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ refinements: a declared BOQ type + free-text units
--
-- Two changes from field feedback on the estimate builder:
--   1. Units go free-text. Estimating teams paste bills that use their own unit
--      conventions; the app now autocompletes and flags an unrecognised unit, but
--      must never block it — so the metric-only DB check is lifted (validation
--      moves to the UI). Existing rows are unaffected.
--   2. Every bill declares HOW it was produced — measured, a rough estimate, or
--      taken off drawings — chosen at creation. Backfilled to 'estimate'.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Free-text units.
alter table public.boq_items drop constraint if exists boq_items_uom_check;

-- 2. BOQ production type.
create type public.boq_type as enum ('measured', 'estimate', 'from_drawing');
alter table public.boqs add column boq_type public.boq_type not null default 'estimate';
