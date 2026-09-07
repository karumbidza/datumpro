-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — chat v2: work-item link chips, @mentions, photo geotags, threads
--
-- 1. message_links     — a message can reference project work items (task /
--                        snag / RFI / payment / drawing). Only the reference is
--                        stored; label and status are resolved live at read time
--                        so a chip can never show a stale status.
-- 2. message_mentions  — @mentions, for the mentioned-row tint and (later)
--                        notification fan-out.
-- 3. message_attachments gains geotag/time columns (lat, lng, taken_at) so a
--                        site photo can carry its evidence metadata.
-- 4. messages(parent_message_id) index — thread reply counts.
--
-- Visibility decision (Allen, 2026-09-07): threads are WHOLE-CHANNEL — a thread
-- inherits its conversation's visibility unchanged. No per-thread ACL. Private
-- discussion already has a home in the task DM. Both new tables mirror
-- message_pins: scope columns denormalized by child_denormalize, RLS double-
-- gated via can_access_chat.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 ── link chips ────────────────────────────────────────────────────────────
create table if not exists public.message_links (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages(id) on delete cascade,
  conversation_id  uuid not null,
  org_id           uuid not null,
  project_id       uuid not null,
  type             text not null,
  dm_contractor_id uuid,
  target_type      text not null check (target_type in ('task', 'snag', 'rfi', 'payment', 'drawing')),
  target_id        uuid not null,
  created_by       uuid not null references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (message_id, target_type, target_id)
);
create index if not exists message_links_message_idx on public.message_links (message_id);
create index if not exists message_links_target_idx  on public.message_links (target_type, target_id);

create trigger message_links_denormalize_trg before insert on public.message_links
  for each row execute function public.child_denormalize();

alter table public.message_links enable row level security;

create policy message_links_select on public.message_links for select
  using ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));

-- Only the message's sender attaches links, at send time.
create policy message_links_insert on public.message_links for insert
  with check (
    created_by = (select auth.uid())
    and (select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id))
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.sender_id = (select auth.uid())
    )
  );

-- 2 ── mentions ──────────────────────────────────────────────────────────────
create table if not exists public.message_mentions (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages(id) on delete cascade,
  conversation_id  uuid not null,
  org_id           uuid not null,
  project_id       uuid not null,
  type             text not null,
  dm_contractor_id uuid,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (message_id, mentioned_user_id)
);
create index if not exists message_mentions_message_idx on public.message_mentions (message_id);
create index if not exists message_mentions_user_idx    on public.message_mentions (mentioned_user_id, created_at desc);

create trigger message_mentions_denormalize_trg before insert on public.message_mentions
  for each row execute function public.child_denormalize();

alter table public.message_mentions enable row level security;

create policy message_mentions_select on public.message_mentions for select
  using ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));

-- Only the message's sender records mentions, at send time.
create policy message_mentions_insert on public.message_mentions for insert
  with check (
    (select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id))
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.sender_id = (select auth.uid())
    )
  );

-- 3 ── photo evidence metadata ───────────────────────────────────────────────
alter table public.message_attachments
  add column if not exists lat      double precision,
  add column if not exists lng      double precision,
  add column if not exists taken_at timestamptz;

-- 4 ── thread reply counts ───────────────────────────────────────────────────
create index if not exists messages_parent_idx
  on public.messages (parent_message_id)
  where parent_message_id is not null;
