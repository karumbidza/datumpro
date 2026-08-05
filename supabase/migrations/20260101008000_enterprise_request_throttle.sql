-- ─────────────────────────────────────────────────────────────────────────────
-- Security assessment F6 — throttle the public enterprise-request RPC
--
-- submit_enterprise_request is the one write the anon role may make, from an
-- unauthenticated public form. Without a limit it can be scripted to flood the
-- review queue or relay spam through the notification email. Add a burst cap in
-- the RPC itself (defence at the data layer; the app also adds a honeypot field).
-- Generous for real buyers, tight for automation:
--   • per-email:  max 3 requests / hour (same contact_email, case-insensitive)
--   • global:     max 10 requests / minute across all submitters
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_enterprise_request(
  p_org_name      text,
  p_buyer_type    text,
  p_country       text,
  p_contact_name  text,
  p_contact_email text,
  p_team_size     text,
  p_needs         text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  req_id            uuid;
  recent_same_email int;
  recent_global     int;
begin
  if coalesce(trim(p_org_name), '') = '' then
    raise exception 'organisation name is required';
  end if;
  if coalesce(trim(p_contact_email), '') = '' or position('@' in p_contact_email) = 0 then
    raise exception 'a valid contact email is required';
  end if;

  -- Per-email burst cap.
  select count(*) into recent_same_email
    from public.enterprise_requests
   where lower(contact_email) = lower(trim(p_contact_email))
     and created_at > now() - interval '1 hour';
  if recent_same_email >= 3 then
    raise exception 'We have already received a few requests from this email. Please give us a little time to respond before sending more.';
  end if;

  -- Global flood guard.
  select count(*) into recent_global
    from public.enterprise_requests
   where created_at > now() - interval '1 minute';
  if recent_global >= 10 then
    raise exception 'Our request form is receiving a lot of traffic right now. Please try again in a minute.';
  end if;

  insert into public.enterprise_requests
    (org_name, buyer_type, country, contact_name, contact_email, team_size, needs)
  values
    (trim(p_org_name), nullif(trim(p_buyer_type), ''), nullif(trim(p_country), ''),
     nullif(trim(p_contact_name), ''), trim(p_contact_email),
     nullif(trim(p_team_size), ''), nullif(trim(p_needs), ''))
  returning id into req_id;

  return req_id;
end;
$$;
