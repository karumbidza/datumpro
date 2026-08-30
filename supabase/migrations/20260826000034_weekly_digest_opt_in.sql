-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — weekly digest email opt-in
--
-- The Monday "your week" digest (Work Pulse by email) is on by default. This adds
-- a per-membership opt-out so anyone can stop receiving it — from their account
-- settings or the one-click unsubscribe link in the email itself.
--
-- org_members is owner/admin-managed (a member can't edit their own row via RLS,
-- and we must never let them, since that row also carries their role). So the
-- self-service toggle goes through a SECURITY DEFINER RPC that only ever touches
-- the opt-in flag for the caller's own membership. The email's unsubscribe link
-- runs with the service role (no session) and updates the flag directly.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.org_members
  add column if not exists weekly_digest_opt_in boolean not null default true;

-- Self-service toggle: flips only the caller's own opt-in for one org.
create or replace function public.set_weekly_digest_opt_in(p_org uuid, p_opt boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.org_members
     set weekly_digest_opt_in = coalesce(p_opt, true)
   where org_id = p_org and user_id = uid;
end $$;

revoke all on function public.set_weekly_digest_opt_in(uuid, boolean) from public;
grant execute on function public.set_weekly_digest_opt_in(uuid, boolean) to authenticated;
