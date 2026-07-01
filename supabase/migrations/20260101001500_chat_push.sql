-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — push notifications for chat (offline delivery)
--
-- Online recipients already get messages over the Realtime private channel. This
-- adds *offline* delivery: a device registers a push subscription, and when a
-- message lands the chat-push Edge Function fans out to the recipients who did
-- not send it and have not already read it.
--
-- Isolation stays in the database. `chat_recipients` enumerates exactly the
-- users `can_access_chat` would admit — one source of truth, so a push can never
-- reach someone who couldn't open the conversation. The Edge Function runs with
-- the service role and calls these SECURITY DEFINER helpers; it never invents its
-- own membership logic.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── device subscriptions (a user may have several: laptop, phone, …) ──
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('web', 'expo')),
  -- web push (RFC 8291): endpoint URL + client keys.
  -- expo:            the Expo push token lives in `endpoint`; keys stay null.
  endpoint     text not null,
  p256dh       text,
  auth         text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
-- A user manages only their own device rows. The Edge Function reads via the
-- service role (RLS bypassed) through the SECURITY DEFINER target function below.
create policy push_subscriptions_rw on public.push_subscriptions for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── who should hear about a message in this conversation ──
-- Set form of can_access_chat: staff + (project members / PM) + bound contractor
-- + explicit participants. Kept in lockstep with the RLS predicate by design.
create or replace function public.chat_recipients(p_conversation_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with c as (select * from public.conversations where id = p_conversation_id)
  select distinct u
  from (
    -- org staff (owner / admin / finance)
    select om.user_id as u
    from c
    join public.org_members om on om.org_id = c.org_id
    where om.status = 'active' and om.role in ('owner', 'admin', 'finance')

    union
    -- project members: whole delivery team for a project chat (contractors are
    -- excluded there); only the PM for a task DM.
    select pm.user_id
    from c
    join public.project_members pm on pm.project_id = c.project_id
    where (c.type = 'project'  and pm.role <> 'contractor')
       or (c.type = 'task_dm'  and pm.role  = 'pm')

    union
    -- the task DM's bound contractor (not the live assignee — matches the RLS rule)
    select c.contractor_id from c where c.type = 'task_dm' and c.contractor_id is not null

    union
    -- explicit participants (e.g. a contractor a PM added to the project chat)
    select cp.user_id
    from c
    join public.conversation_participants cp on cp.conversation_id = c.id
  ) s
  where u is not null;
$$;

-- ── the fan-out target list for one message ──
-- Every device of every recipient who is NOT the sender and has NOT already read
-- up to this message. The Edge Function iterates the rows and posts to each push
-- service; on a 404/410/DeviceNotRegistered it deletes the stale subscription.
create or replace function public.chat_push_targets(p_message_id uuid)
returns table (
  subscription_id uuid,
  user_id         uuid,
  platform        text,
  endpoint        text,
  p256dh          text,
  auth            text
) language sql stable security definer set search_path = '' as $$
  with m as (select * from public.messages where id = p_message_id)
  select ps.id, ps.user_id, ps.platform, ps.endpoint, ps.p256dh, ps.auth
  from m
  join public.chat_recipients(m.conversation_id) as r(uid) on true
  join public.push_subscriptions ps on ps.user_id = r.uid
  left join public.chat_read_state rs
    on rs.conversation_id = m.conversation_id and rs.user_id = r.uid
  where r.uid <> m.sender_id
    and m.deleted_at is null
    and coalesce(rs.last_read_seq, 0) < m.seq;
$$;
