-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — chat (project group + task DM), doubly authorized
--
-- Isolation is enforced in the database. Two surfaces:
--   • project chat  — one per project; delivery team + staff (contractors are
--                     excluded unless a PM explicitly adds them as a participant).
--   • task DM       — one ACTIVE conversation per task, bound to a specific
--                     contractor. Cost-confidential: only staff, the project PM,
--                     and that conversation's contractor. On reassignment the DM
--                     is archived and a fresh one is created, so a new contractor
--                     never inherits the previous contractor's rate history.
--
-- Every row denormalizes org_id/project_id/type/dm_contractor_id so the RLS
-- predicate (can_access_chat) never joins. Realtime private channels are
-- authorized by the SAME predicate on realtime.messages, and chat media by the
-- same predicate on a dedicated chat-media bucket — authorized twice by design.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists last_active_at timestamptz;

-- ── conversations ──
create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null,
  task_id       uuid,                       -- null = project chat
  type          text not null check (type in ('project', 'task_dm')),
  contractor_id uuid references auth.users(id) on delete set null,  -- task_dm: the bound contractor
  status        text not null default 'active' check (status in ('active', 'archived')),
  title         text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  foreign key (task_id, org_id)    references public.tasks (id, org_id)    on delete cascade
);
create unique index conversations_one_project_chat on public.conversations (project_id) where type = 'project';
create unique index conversations_one_active_dm    on public.conversations (task_id)    where type = 'task_dm' and status = 'active';
create index conversations_project_idx on public.conversations (project_id);
create index conversations_task_idx    on public.conversations (task_id);

create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

-- ── explicit membership (contractor added to project chat / future group DM) ──
create table public.conversation_participants (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  added_by        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (conversation_id, user_id)
);
create index conversation_participants_conv_idx on public.conversation_participants (conversation_id);

-- ── per-user read cursor (pure UI state; NO authorization meaning) ──
create table public.chat_read_state (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  last_read_seq   bigint not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ── messages ──
create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity,   -- monotonic; cursor + tiebreak
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  -- denormalized for join-free RLS (populated by trigger from the conversation)
  org_id            uuid not null references public.organizations(id) on delete cascade,
  project_id        uuid not null,
  task_id           uuid,
  type              text not null,
  dm_contractor_id  uuid,
  sender_id         uuid not null references auth.users(id) on delete cascade,
  parent_message_id uuid references public.messages(id) on delete set null,
  body              text,
  edited_at         timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  search_tsv        tsvector generated always as (to_tsvector('simple', coalesce(body, ''))) stored
);
create index messages_conv_seq_idx on public.messages (conversation_id, seq desc);
create index messages_parent_idx   on public.messages (parent_message_id);
create index messages_search_idx   on public.messages using gin (search_tsv);

-- ── receipts / reactions / attachments (denormalized identically) ──
create table public.message_receipts (
  message_id       uuid not null references public.messages(id) on delete cascade,
  conversation_id  uuid not null,
  org_id           uuid not null,
  project_id       uuid not null,
  type             text not null,
  dm_contractor_id uuid,
  user_id          uuid not null references auth.users(id) on delete cascade,
  delivered_at     timestamptz,
  read_at          timestamptz,
  primary key (message_id, user_id)
);
create index message_receipts_user_idx on public.message_receipts (user_id);

create table public.message_reactions (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages(id) on delete cascade,
  conversation_id  uuid not null,
  org_id           uuid not null,
  project_id       uuid not null,
  type             text not null,
  dm_contractor_id uuid,
  user_id          uuid not null references auth.users(id) on delete cascade,
  emoji            text not null,
  created_at       timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create table public.message_attachments (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages(id) on delete cascade,
  conversation_id  uuid not null,
  org_id           uuid not null,
  project_id       uuid not null,
  type             text not null,
  dm_contractor_id uuid,
  kind             text not null,        -- image | video | audio | document | location(future)
  storage_path     text not null,
  mime             text,
  size_bytes       bigint,
  duration_seconds numeric,
  width            int,
  height           int,
  thumbnail_path   text,
  created_at       timestamptz not null default now()
);
create index message_attachments_message_idx on public.message_attachments (message_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Access helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id = (select auth.uid())
  );
$$;

-- The one predicate. task_dm binds to the conversation's contractor (NOT the live
-- task assignee) so reassignment can't leak history.
create or replace function public.can_access_chat(
  p_type text, p_org_id uuid, p_project_id uuid, p_dm_contractor uuid, p_conversation_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_type = 'task_dm' then
         public.is_org_staff(p_org_id)
      or public.project_role(p_project_id) = 'pm'
      or p_dm_contractor = (select auth.uid())
      or public.is_conversation_participant(p_conversation_id)
    else
         public.is_org_staff(p_org_id)
      or (public.is_project_member(p_project_id) and public.project_role(p_project_id) <> 'contractor')
      or public.is_conversation_participant(p_conversation_id)
  end;
$$;

-- Conversation-level check (loads the row) — used by conversations RLS, the
-- Realtime policy, and storage.
create or replace function public.can_access_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and public.can_access_chat(c.type, c.org_id, c.project_id, c.contractor_id, c.id)
  );
$$;

create or replace function public.conversation_is_active(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.status = 'active' from public.conversations c where c.id = p_conversation_id), false);
$$;

-- Realtime topic 'chat:<uuid>' → conversation id (null for anything else).
create or replace function public.conversation_from_topic(p_topic text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_topic like 'chat:%' then public.safe_uuid(substr(p_topic, 6)) else null end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-provisioning triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- Project chat exists from the moment a project does.
create or replace function public.create_project_chat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.conversations (org_id, project_id, type, created_by, title)
  values (new.org_id, new.id, 'project', new.created_by, 'Project chat')
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists on_project_created_chat on public.projects;
create trigger on_project_created_chat
  after insert on public.projects
  for each row execute function public.create_project_chat();

-- Task DM created on assignment; rotated (archive + fresh) on reassignment.
create or replace function public.rotate_task_dm()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;  -- assignee unchanged
  end if;

  -- Archive the current active DM (previous contractor keeps read access to it).
  update public.conversations
     set status = 'archived'
   where task_id = new.id and type = 'task_dm' and status = 'active';

  -- Provision a fresh DM for the new assignee (if any).
  if new.assignee_id is not null then
    insert into public.conversations (org_id, project_id, task_id, type, contractor_id, created_by, title)
    values (new.org_id, new.project_id, new.id, 'task_dm', new.assignee_id,
            coalesce((select auth.uid()), new.assignee_id), 'Task discussion');
  end if;
  return new;
end;
$$;
drop trigger if exists on_task_assignment_dm on public.tasks;
create trigger on_task_assignment_dm
  after insert or update of assignee_id on public.tasks
  for each row execute function public.rotate_task_dm();

-- ─────────────────────────────────────────────────────────────────────────────
-- Denormalization triggers (server-authoritative; the client can't spoof scope)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.messages_denormalize()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = new.conversation_id;
  if not found then raise exception 'conversation not found'; end if;
  if c.type = 'task_dm' and c.status <> 'active' then
    raise exception 'this conversation is archived';
  end if;
  new.org_id           := c.org_id;
  new.project_id       := c.project_id;
  new.task_id          := c.task_id;
  new.type             := c.type;
  new.dm_contractor_id := c.contractor_id;
  return new;
end;
$$;
create trigger messages_denormalize_trg before insert on public.messages
  for each row execute function public.messages_denormalize();

-- receipts / reactions / attachments inherit scope from their message.
create or replace function public.child_denormalize()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id = new.message_id;
  if not found then raise exception 'message not found'; end if;
  new.conversation_id  := m.conversation_id;
  new.org_id           := m.org_id;
  new.project_id       := m.project_id;
  new.type             := m.type;
  new.dm_contractor_id := m.dm_contractor_id;
  return new;
end;
$$;
create trigger message_receipts_denormalize_trg before insert on public.message_receipts
  for each row execute function public.child_denormalize();
create trigger message_reactions_denormalize_trg before insert on public.message_reactions
  for each row execute function public.child_denormalize();
create trigger message_attachments_denormalize_trg before insert on public.message_attachments
  for each row execute function public.child_denormalize();

-- ─────────────────────────────────────────────────────────────────────────────
-- Broadcast-from-database (private channel). No-op safe if realtime is absent.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.broadcast_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'conversation_id', new.conversation_id,
                       'sender_id', new.sender_id, 'seq', new.seq, 'op', tg_op),
    'message', 'chat:' || new.conversation_id::text, true);
  return null;
exception when others then
  return null;  -- never let delivery break the write
end;
$$;
create trigger messages_broadcast_trg after insert or update on public.messages
  for each row execute function public.broadcast_message();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.conversations           enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.chat_read_state          enable row level security;
alter table public.messages                 enable row level security;
alter table public.message_receipts         enable row level security;
alter table public.message_reactions        enable row level security;
alter table public.message_attachments      enable row level security;

-- conversations
create policy conversations_select on public.conversations for select
  using ((select public.can_access_conversation(id)));
create policy conversations_write on public.conversations for all
  using ((select public.is_org_staff(org_id)) or (select public.project_role(project_id)) = 'pm')
  with check ((select public.is_org_staff(org_id)) or (select public.project_role(project_id)) = 'pm');

-- participants (managers add/remove; anyone with access can see the roster)
create policy conversation_participants_select on public.conversation_participants for select
  using ((select public.can_access_conversation(conversation_id)));
create policy conversation_participants_write on public.conversation_participants for all
  using ((select public.is_org_staff(org_id)) or (select public.project_role(project_id)) = 'pm')
  with check ((select public.is_org_staff(org_id)) or (select public.project_role(project_id)) = 'pm');

-- read cursor (each user manages only their own; no auth meaning)
create policy chat_read_state_rw on public.chat_read_state for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- messages
create policy messages_select on public.messages for select
  using ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));
create policy messages_insert on public.messages for insert
  with check (
    sender_id = (select auth.uid())
    and (select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id))
  );
create policy messages_update on public.messages for update
  using (
    sender_id = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or (select public.project_role(project_id)) = 'pm'
  )
  with check ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));

-- receipts (see all for seen-by; write only your own)
create policy message_receipts_select on public.message_receipts for select
  using ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));
create policy message_receipts_write on public.message_receipts for all
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id))
  );

-- reactions (see all; write only your own)
create policy message_reactions_select on public.message_reactions for select
  using ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));
create policy message_reactions_write on public.message_reactions for all
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id))
  );

-- attachments
create policy message_attachments_select on public.message_attachments for select
  using ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));
create policy message_attachments_insert on public.message_attachments for insert
  with check ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime authorization — the second gate (private channel 'chat:<conversation>')
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists chat_realtime_read on realtime.messages;
create policy chat_realtime_read on realtime.messages for select to authenticated
  using (
    extension in ('broadcast', 'presence')
    and (select public.can_access_conversation(public.conversation_from_topic(realtime.topic())))
  );
drop policy if exists chat_realtime_send on realtime.messages;
create policy chat_realtime_send on realtime.messages for insert to authenticated
  with check (
    extension in ('broadcast', 'presence')
    and (select public.can_access_conversation(public.conversation_from_topic(realtime.topic())))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage — dedicated confidential chat bucket, conversation-keyed
-- Path: {org_id}/{project_id}/chat/{conversation_id}/{file}  → segment [4] = conversation
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', false)
  on conflict (id) do nothing;

create policy "chat-media read" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (select public.can_access_conversation(public.safe_uuid((storage.foldername(name))[4])))
  );
create policy "chat-media upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (select public.can_access_conversation(public.safe_uuid((storage.foldername(name))[4])))
  );
create policy "chat-media delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (select public.can_access_conversation(public.safe_uuid((storage.foldername(name))[4])))
  );
