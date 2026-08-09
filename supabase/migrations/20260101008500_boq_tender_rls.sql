-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ sealed tender (Phase 1: RLS, soft-seal, RPCs)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_tender_bidder(p_tender_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boq_bidders b
    where b.tender_id = p_tender_id
      and b.user_id = (select auth.uid())
      and b.status <> 'withdrawn'
  );
$$;

create or replace function public.my_bidder_id(p_tender_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select b.id from public.boq_bidders b
  where b.tender_id = p_tender_id and b.user_id = (select auth.uid())
  limit 1;
$$;

alter table public.boq_tenders   enable row level security;
alter table public.boq_bidders   enable row level security;
alter table public.boq_bid_items enable row level security;

create policy boq_tenders_select on public.boq_tenders for select
  using ((select public.is_org_member(org_id)) or (select public.is_tender_bidder(id)));
create policy boq_tenders_write on public.boq_tenders for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');

create policy boq_bidders_staff on public.boq_bidders for all
  using ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
  with check ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm');
create policy boq_bidders_self_read on public.boq_bidders for select
  using (user_id = (select auth.uid()));

create policy boq_bid_items_staff_read on public.boq_bid_items for select
  using (
    ((select public.is_org_admin(org_id)) or (select public.org_role(org_id)) = 'pm')
    and exists (
      select 1 from public.boq_bidders bd
      join public.boq_tenders t on t.id = bd.tender_id
      where bd.id = boq_bid_items.bidder_id and t.unsealed_at is not null
    )
  );
create policy boq_bid_items_bidder_rw on public.boq_bid_items for all
  using (
    exists (select 1 from public.boq_bidders bd
            where bd.id = boq_bid_items.bidder_id
              and bd.user_id = (select auth.uid())
              and bd.status in ('invited','viewing'))
  )
  with check (
    exists (select 1 from public.boq_bidders bd
            where bd.id = boq_bid_items.bidder_id
              and bd.user_id = (select auth.uid())
              and bd.status in ('invited','viewing'))
  );

-- Bidder-safe bill projection — NEVER returns budget_rate_cents.
create or replace function public.tender_bill_lines(p_tender_id uuid)
returns table (
  section_id uuid, section_name text, section_position int,
  item_id uuid, description text, uom text, qty numeric, item_position int
) language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.position,
         i.id, i.description, i.uom, i.qty, i.position
  from public.boq_tenders t
  join public.boqs b            on b.id = t.boq_id
  join public.boq_sections s    on s.boq_id = b.id
  join public.boq_items i       on i.section_id = s.id
  where t.id = p_tender_id
    and (public.is_tender_bidder(p_tender_id) or public.is_org_member(t.org_id))
  order by s.position, i.position;
$$;
revoke all on function public.tender_bill_lines(uuid) from public;
grant execute on function public.tender_bill_lines(uuid) to authenticated;

create or replace function public.create_tender(p_boq_id uuid, p_title text, p_close_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); v_org uuid; new_id uuid;
begin
  select org_id into v_org from public.boqs where id = p_boq_id;
  if v_org is null then raise exception 'boq not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
    raise exception 'not authorised';
  end if;
  insert into public.boq_tenders (org_id, boq_id, title, close_at, status, created_by)
  values (v_org, p_boq_id, coalesce(nullif(trim(p_title),''), 'Tender'), p_close_at, 'open', uid)
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.create_tender(uuid, text, timestamptz) from public;
grant execute on function public.create_tender(uuid, text, timestamptz) to authenticated;

create or replace function public.invite_boq_bidder(
  p_tender_id uuid, p_company_name text, p_email text, p_user_id uuid default null
) returns table (bidder_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select org_id into v_org from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
    raise exception 'not authorised';
  end if;
  insert into public.boq_bidders (org_id, tender_id, company_name, contact_email, user_id, invite_token, invited_by)
  values (v_org, p_tender_id, trim(p_company_name), lower(trim(p_email)), p_user_id, v_token, (select auth.uid()))
  on conflict (tender_id, lower(contact_email)) do update
    set company_name = excluded.company_name,
        user_id = coalesce(public.boq_bidders.user_id, excluded.user_id)
  returning id, invite_token into bidder_id, token;
  return next;
end; $$;
revoke all on function public.invite_boq_bidder(uuid, text, text, uuid) from public;
grant execute on function public.invite_boq_bidder(uuid, text, text, uuid) to authenticated;

create or replace function public.accept_boq_bid_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare bd public.boq_bidders; uid uuid := (select auth.uid()); uemail text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into bd from public.boq_bidders where invite_token = p_token;
  if not found then raise exception 'invitation not found'; end if;
  if bd.status = 'withdrawn' then raise exception 'invitation withdrawn'; end if;
  select lower(email) into uemail from auth.users where id = uid;
  if uemail is distinct from lower(bd.contact_email) then
    raise exception 'invitation was sent to a different email address';
  end if;
  update public.boq_bidders
    set user_id = uid, status = case when status = 'invited' then 'viewing' else status end
    where id = bd.id;
  return bd.tender_id;
end; $$;
revoke all on function public.accept_boq_bid_invite(text) from public;
grant execute on function public.accept_boq_bid_invite(text) to authenticated;

create or replace function public.submit_boq_bid(p_bidder_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare bd public.boq_bidders; t public.boq_tenders;
begin
  select * into bd from public.boq_bidders where id = p_bidder_id;
  if not found or bd.user_id is distinct from (select auth.uid()) then
    raise exception 'not your bid'; end if;
  select * into t from public.boq_tenders where id = bd.tender_id;
  if t.close_at is not null and t.close_at < now() then raise exception 'tender closed'; end if;
  if bd.status not in ('invited','viewing') then raise exception 'already submitted'; end if;
  update public.boq_bidders set status = 'submitted', submitted_at = now() where id = bd.id;
end; $$;
revoke all on function public.submit_boq_bid(uuid) from public;
grant execute on function public.submit_boq_bid(uuid) to authenticated;
