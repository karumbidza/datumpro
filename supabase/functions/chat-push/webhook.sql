-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL — wire the chat-push Edge Function with a SQL trigger instead of the
-- dashboard Database Webhook. Prefer the dashboard route (see README) unless you
-- want the trigger versioned in SQL. Requires the pg_net extension.
--
-- Set the two settings once (values are your deployed function URL + shared
-- secret), then create the trigger:
--
--   alter database postgres set app.chat_push_url    = 'https://<ref>.supabase.co/functions/v1/chat-push';
--   alter database postgres set app.chat_push_secret = '<same value as CHAT_PUSH_SECRET>';
--
-- (Run the ALTER DATABASE as the project owner; reconnect for it to take effect.)
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_net;

create or replace function public.chat_push_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_url    text := current_setting('app.chat_push_url', true);
  v_secret text := current_setting('app.chat_push_secret', true);
begin
  if v_url is null or v_url = '' then
    return null;  -- not configured; no-op
  end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-webhook-secret', coalesce(v_secret, '')
    ),
    body    := jsonb_build_object(
      'type', 'INSERT', 'table', 'messages', 'schema', 'public',
      'record', to_jsonb(new)
    )
  );
  return null;
exception when others then
  return null;  -- delivery must never break the write
end;
$$;

drop trigger if exists chat_push_notify_trg on public.messages;
create trigger chat_push_notify_trg after insert on public.messages
  for each row execute function public.chat_push_notify();
