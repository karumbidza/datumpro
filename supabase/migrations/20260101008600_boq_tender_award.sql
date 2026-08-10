-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — BOQ sealed tender (Phase 2: unseal + award)
-- No new tables/RLS: staff price-reads are already gated on unsealed_at.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tender_unseal_eligible(p_tender_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with b as (
    select status from public.boq_bidders
    where tender_id = p_tender_id and status <> 'withdrawn'
  ),
  t as (select close_at from public.boq_tenders where id = p_tender_id)
  select
    (select count(*) from b where status = 'submitted') >= 1
    and (
      (select count(*) from b where status <> 'submitted') = 0
      or ((select close_at from t) is not null and (select close_at from t) < now())
    );
$$;
revoke all on function public.tender_unseal_eligible(uuid) from public;
grant execute on function public.tender_unseal_eligible(uuid) to authenticated;

create or replace function public.unseal_tender(p_tender_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_when timestamptz; v_existing timestamptz;
begin
  select org_id, unsealed_at into v_org, v_existing from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
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
revoke all on function public.unseal_tender(uuid) from public;
grant execute on function public.unseal_tender(uuid) to authenticated;

create or replace function public.award_tender(p_tender_id uuid, p_bidder_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_sealed timestamptz; v_bidder_ok boolean;
begin
  select org_id, unsealed_at into v_org, v_sealed from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
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
revoke all on function public.award_tender(uuid, uuid) from public;
grant execute on function public.award_tender(uuid, uuid) to authenticated;
