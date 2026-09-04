-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — push every in-app notification to the user's phone
--
-- A per-user notifications feed already exists (the bell + realtime web toast).
-- Until now, only *some* origins also reached the phone: the web app pushed
-- inline from notifyUser(), but notifications created from the mobile app and by
-- the pg_cron reminder sweeps (remind_open_action_items / the acceptance nudge)
-- were in-app ONLY — they never buzzed the device.
--
-- Close the gap at the source: a single AFTER INSERT trigger on public
-- notifications hands the new row to the `notification-push` Edge Function, which
-- fans it out to every device the recipient has registered (Expo for mobile,
-- Web Push/VAPID for browsers). Because it fires on the row itself, EVERY origin
-- — web, mobile, and cron — now reaches the phone through one path, so callers no
-- longer push separately (the web app's inline push is removed in the same change
-- to avoid a double buzz).
--
-- Delivery is fire-and-forget over pg_net and must never break the write that
-- created the notification, so the function swallows every error and no-ops when
-- the URL setting is absent (e.g. a local shadow db / CI, where pg_net or the
-- function may not exist).
--
-- Operator setup (run once, as the project owner; reconnect to take effect):
--   alter database postgres set app.notification_push_url    = 'https://<ref>.supabase.co/functions/v1/notification-push';
--   alter database postgres set app.notification_push_secret = '<same value as NOTIFICATION_PUSH_SECRET>';
-- ─────────────────────────────────────────────────────────────────────────────

-- pg_net powers the async outbound POST. Attempt to enable it, but never let its
-- absence fail the migration (the trigger function no-ops without it).
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net unavailable — notification push trigger will no-op until it is enabled (%).', sqlerrm;
end;
$$;

create or replace function public.notification_push_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_url    text := current_setting('app.notification_push_url', true);
  v_secret text := current_setting('app.notification_push_secret', true);
begin
  if v_url is null or v_url = '' then
    return null;  -- not configured (local / CI); no-op
  end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-webhook-secret', coalesce(v_secret, '')
    ),
    body    := jsonb_build_object(
      'type', 'INSERT', 'table', 'notifications', 'schema', 'public',
      'record', to_jsonb(new)
    )
  );
  return null;
exception when others then
  return null;  -- delivery must never break the write
end;
$$;

drop trigger if exists notification_push_notify_trg on public.notifications;
create trigger notification_push_notify_trg after insert on public.notifications
  for each row execute function public.notification_push_notify();
