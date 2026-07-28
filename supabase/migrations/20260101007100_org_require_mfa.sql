-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — org-level MFA requirement
--
-- When true, every member of the org must have passed a TOTP challenge (session
-- AAL2) before using the app. Enforced in the app shell; Supabase manages the
-- factors themselves in auth.*.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists require_mfa boolean not null default false;
