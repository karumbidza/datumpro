-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — harden the tender RPC auth guards against a non-member bypass.
-- The guard `not (is_org_admin(org) or org_role(org) = 'pm')` evaluates to NULL for a
-- NON-member (both helpers return NULL), and `NOT NULL` is NULL, so the IF never fires
-- and a non-member slips through to these SECURITY DEFINER bodies. Coalesce both sides.
-- Only the guard line changes in each of the four functions below.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_tender(p_boq_id uuid, p_title text, p_close_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); v_org uuid; new_id uuid;
begin
  select org_id into v_org from public.boqs where id = p_boq_id;
  if v_org is null then raise exception 'boq not found'; end if;
  if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then
    raise exception 'not authorised';
  end if;
  insert into public.boq_tenders (org_id, boq_id, title, close_at, status, created_by)
  values (v_org, p_boq_id, coalesce(nullif(trim(p_title),''), 'Tender'), p_close_at, 'open', uid)
  returning id into new_id;
  return new_id;
end; $$;

create or replace function public.unseal_tender(p_tender_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_when timestamptz; v_existing timestamptz;
begin
  select org_id, unsealed_at into v_org, v_existing from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_existing is not null then return v_existing; end if;
  if not public.tender_unseal_eligible(p_tender_id) then
    raise exception 'tender is not yet eligible to unseal (all bidders must submit, or the deadline must pass)';
  end if;
  v_when := now();
  update public.boq_tenders set status = 'closed', unsealed_at = v_when, updated_at = now()
    where id = p_tender_id;
  return v_when;
end; $$;

create or replace function public.award_boq_tender(p_tender_id uuid, p_bidder_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_sealed timestamptz; v_bidder_ok boolean;
begin
  select org_id, unsealed_at into v_org, v_sealed from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_sealed is null then raise exception 'unseal the tender before awarding'; end if;
  select exists (
    select 1 from public.boq_bidders
    where id = p_bidder_id and tender_id = p_tender_id and status = 'submitted'
  ) into v_bidder_ok;
  if not v_bidder_ok then raise exception 'that bidder is not a submitted bidder on this tender'; end if;
  update public.boq_tenders
    set status = 'awarded', awarded_bidder_id = p_bidder_id, updated_at = now()
    where id = p_tender_id;
end; $$;

create or replace function public.invite_boq_bidder(
  p_tender_id uuid, p_company_name text, p_email text, p_user_id uuid default null
) returns table (bidder_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select org_id into v_org from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then
    raise exception 'not authorised';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.org_members m
    where m.org_id = v_org and m.user_id = p_user_id and m.status = 'active'
  ) then
    raise exception 'named user is not an active member of this organisation';
  end if;
  insert into public.boq_bidders (org_id, tender_id, company_name, contact_email, user_id, invite_token, invited_by)
  values (v_org, p_tender_id, trim(p_company_name), lower(trim(p_email)), p_user_id, v_token, (select auth.uid()))
  on conflict (tender_id, lower(contact_email)) do update
    set company_name = excluded.company_name,
        user_id = coalesce(public.boq_bidders.user_id, excluded.user_id)
  returning id, invite_token into bidder_id, token;
  return next;
end; $$;
