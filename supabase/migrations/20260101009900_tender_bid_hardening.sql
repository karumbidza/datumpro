-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — tender bid hardening (spec 2026-08-25-tender-excel-roundtrip)
--
-- • save_bid_lines: bulk counterpart of the per-cell save, for the Excel
--   round-trip. Token + bound-user double check, open-tender check, every line
--   validated against THIS tender's bill, values clamped by validation, and a
--   rolling-hour rate limit (10 calls) on the bidder row.
-- • accept_boq_bid_invite: a FIRST-TIME claim is rejected once the tender has
--   closed (bound bidders still pass — they revisit their read-only bid).
-- • rotate_bid_invite_token: staff resend issues a fresh token; the old link
--   in a forwarded email goes dead.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boq_bidders
  add column bulk_upload_count int not null default 0,
  add column bulk_upload_window_start timestamptz;

create or replace function public.save_bid_lines(p_token text, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bd public.boq_bidders; t public.boq_tenders;
  uid uuid := (select auth.uid());
  v_n int; v_valid int; v_distinct int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into bd from public.boq_bidders where invite_token = p_token;
  -- Both the token AND the bound account must match — a leaked token alone is dead.
  if not found or bd.user_id is null or bd.user_id <> uid then
    raise exception 'not your bid';
  end if;
  if bd.status not in ('invited','viewing') then raise exception 'already submitted'; end if;
  select * into t from public.boq_tenders where id = bd.tender_id;
  if t.status <> 'open' or (t.close_at is not null and t.close_at < now()) then
    raise exception 'tender closed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'invalid payload'; end if;
  v_n := jsonb_array_length(p_lines);
  if v_n = 0 then raise exception 'no lines to save'; end if;
  if v_n > 2000 then raise exception 'too many lines'; end if;

  -- Rolling-hour rate limit on bulk saves.
  if bd.bulk_upload_window_start is null or bd.bulk_upload_window_start < now() - interval '1 hour' then
    update public.boq_bidders set bulk_upload_window_start = now(), bulk_upload_count = 1 where id = bd.id;
  elsif bd.bulk_upload_count >= 10 then
    raise exception 'too many uploads — try again in a while';
  else
    update public.boq_bidders set bulk_upload_count = bulk_upload_count + 1 where id = bd.id;
  end if;

  -- Every line must be a real line of THIS tender's bill with sane values;
  -- any bad line rejects the whole call (no partial writes).
  select count(*) into v_valid
  from jsonb_array_elements(p_lines) e
  join public.boq_items i on i.id = (e->>'item_id')::uuid
  join public.boq_sections s on s.id = i.section_id and s.boq_id = t.boq_id
  where (e->>'rate_cents')::bigint >= 0
    and (nullif(e->>'duration_days','') is null
         or (e->>'duration_days')::int between 0 and 3650);
  if v_valid <> v_n then
    raise exception 'the upload contains lines that are not part of this bill';
  end if;
  select count(distinct (e->>'item_id')::uuid) into v_distinct from jsonb_array_elements(p_lines) e;
  if v_distinct <> v_n then raise exception 'the upload contains duplicate lines'; end if;

  insert into public.boq_bid_items (org_id, bidder_id, boq_item_id, rate_cents, no_bid, duration_days)
  select bd.org_id, bd.id,
         (e->>'item_id')::uuid,
         (e->>'rate_cents')::bigint,
         false,
         nullif(e->>'duration_days','')::int
  from jsonb_array_elements(p_lines) e
  on conflict (bidder_id, boq_item_id) do update
    set rate_cents = excluded.rate_cents,
        duration_days = excluded.duration_days,
        no_bid = false,
        updated_at = now();

  return jsonb_build_object('saved', v_n);
end $$;
revoke all on function public.save_bid_lines(text, jsonb) from public;
grant execute on function public.save_bid_lines(text, jsonb) to authenticated;

create or replace function public.accept_boq_bid_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare bd public.boq_bidders; t public.boq_tenders; uid uuid := (select auth.uid()); uemail text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into bd from public.boq_bidders where invite_token = p_token;
  if not found then raise exception 'invitation not found'; end if;
  if bd.status = 'withdrawn' then raise exception 'invitation withdrawn'; end if;
  select lower(email) into uemail from auth.users where id = uid;
  if uemail is distinct from lower(bd.contact_email) then
    raise exception 'invitation was sent to a different email address';
  end if;
  -- A first-time claim of a closed tender is refused; an already-bound bidder
  -- passes through to their (read-only) bid.
  if bd.user_id is null then
    select * into t from public.boq_tenders where id = bd.tender_id;
    if t.status in ('closed','cancelled') or (t.close_at is not null and t.close_at < now()) then
      raise exception 'this tender has closed';
    end if;
  end if;
  update public.boq_bidders
    set user_id = uid, status = case when status = 'invited' then 'viewing' else status end
    where id = bd.id;
  return bd.tender_id;
end; $$;
revoke all on function public.accept_boq_bid_invite(text) from public;
grant execute on function public.accept_boq_bid_invite(text) to authenticated;

create or replace function public.rotate_bid_invite_token(p_bidder_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_status text;
        v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select org_id, status::text into v_org, v_status from public.boq_bidders where id = p_bidder_id;
  if v_org is null then raise exception 'bidder not found'; end if;
  if not (coalesce(public.is_org_admin(v_org), false) or coalesce(public.org_role(v_org), '') = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_status not in ('invited','viewing') then
    raise exception 'cannot rotate a link for a submitted or withdrawn bid';
  end if;
  update public.boq_bidders set invite_token = v_token where id = p_bidder_id;
  return v_token;
end $$;
revoke all on function public.rotate_bid_invite_token(uuid) from public;
grant execute on function public.rotate_bid_invite_token(uuid) to authenticated;
