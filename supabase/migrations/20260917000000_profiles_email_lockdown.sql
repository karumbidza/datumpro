-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — profiles email lockdown (security audit UB-AUD-1709 finding #1)
--
-- Problem: the `profiles_select` policy exposes a row to any co-org member
-- (self OR shares_org). That is the right rule for DISPLAY data (names, avatars
-- render in chat/tasks across the org), but it also handed every signed-in user
-- — contractors included — every colleague's `email` straight off
-- `/rest/v1/profiles`, bypassing the app's own `redactContacts` rules. An
-- external auditor read the owner's email while signed in as a contractor.
--
-- Fix: keep the row policy (names/avatars stay co-org visible) but drop `email`
-- from what the `authenticated` role may SELECT. Column-level privileges are
-- role-wide, so we revoke the blanket table SELECT and re-grant every column
-- EXCEPT `email`. Email is then reachable only by:
--   • the service role (background jobs, admin/Pulse tooling) — bypasses grants;
--   • `public.visible_member_emails()` below — an authorized, gated path;
--   • the user themselves, from their auth session (`auth.users.email`).
--
-- ⚠️  MAINTENANCE: any NEW column added to public.profiles must be added to the
-- GRANT below, or it will be invisible to the app (PostgREST omits ungranted
-- columns; `select('*')` errors). `email` is intentionally excluded.
--
-- `phone` stays readable: it is deliberately shared (WhatsApp-first site contact,
-- and `redactContacts` never hid it). Only `email` was the audit finding.
-- ─────────────────────────────────────────────────────────────────────────────

revoke select on public.profiles from anon, authenticated;

grant select (
  id,
  display_name,
  avatar_url,
  created_at,
  username,
  phone,
  company_name,
  trade,
  avatar_thumb_url,
  avatar_updated_at,
  last_active_at,
  company
) on public.profiles to authenticated;

-- ── Authorized email resolution ──────────────────────────────────────────────
-- Returns emails for the requested user ids that the CALLER is allowed to see:
--   • always your own;
--   • a co-member's email only if you are owner/admin/pm/finance in an org you
--     both belong to (i.e. management, who legitimately manage & contact people).
-- Contractors/staff/viewers get nothing but their own — matching the intent of
-- `redactContacts` (contact details are management-visible, not peer-visible).
--
-- SECURITY DEFINER so it can read the (now grant-revoked) email column; hardened
-- with an empty search_path + fully-qualified names.
create or replace function public.visible_member_emails(p_ids uuid[])
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email
  from public.profiles p
  where p.id = any (p_ids)
    and (
      p.id = (select auth.uid())
      or exists (
        select 1
        from public.org_members me
        join public.org_members them on them.org_id = me.org_id
        where me.user_id = (select auth.uid())
          and me.status = 'active'
          -- management, per the app's redactContacts rule (member_type), with an
          -- org_role backstop so owners/admins qualify even if member_type is unset.
          and (
            me.member_type in ('owner', 'admin', 'pm')
            or me.role in ('owner', 'admin', 'finance', 'pm')
          )
          and them.user_id = p.id
          and them.status = 'active'
      )
    );
$$;

revoke all on function public.visible_member_emails(uuid[]) from public, anon;
grant execute on function public.visible_member_emails(uuid[]) to authenticated;
