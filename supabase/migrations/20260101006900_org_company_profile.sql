-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — organization company profile
--
-- Onboarding Phase 1: capture a lightweight, on-record company profile at org
-- creation (legal name, country, sector, registration number) plus a marker for
-- when first-run onboarding was completed. All nullable — existing orgs are
-- unaffected and keep working with just `name`.
--
-- NOTE (scope boundary): this is the ORG-level profile. The invitee's PERSONAL
-- profile (username, avatar, national_id) is owned by Handover A / snag-spec §1
-- and is intentionally not touched here.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists legal_name              text,
  add column if not exists country                 text,
  add column if not exists sector                  text,
  add column if not exists registration_number     text,
  add column if not exists onboarding_completed_at timestamptz;
