-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — is_org_staff() + tighten BOQ library/tender reads to staff.
-- Contractors are org_role 'member' (same as staff); this helper keys on
-- member_type so RLS can hide the BOQ library + PRIVATE budget rates from them.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_org_staff(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.member_type in ('owner','admin','pm','staff')
  );
$$;
revoke all on function public.is_org_staff(uuid) from public;
grant execute on function public.is_org_staff(uuid) to authenticated;

-- BOQ library: staff-only reads (was is_org_member).
drop policy boqs_select on public.boqs;
create policy boqs_select on public.boqs for select
  using ((select public.is_org_staff(org_id)));

drop policy boq_sections_select on public.boq_sections;
create policy boq_sections_select on public.boq_sections for select
  using ((select public.is_org_staff(org_id)));

drop policy boq_items_select on public.boq_items;
create policy boq_items_select on public.boq_items for select
  using ((select public.is_org_staff(org_id)));

-- Tenders: staff see all; a contractor sees only tenders they bid on.
drop policy boq_tenders_select on public.boq_tenders;
create policy boq_tenders_select on public.boq_tenders for select
  using ((select public.is_org_staff(org_id)) or (select public.is_tender_bidder(id)));
