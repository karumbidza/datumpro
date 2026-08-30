-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — pinned chat messages
--
-- Any chat member can pin an important message so it's easy to find in the
-- right-rail's Pinned tab; the pinner or a manager can unpin. Mirrors
-- message_reactions: scope columns are denormalized from the parent message by the
-- shared child_denormalize trigger, and RLS is the same double gate via
-- can_access_chat, so a client only sees pins on conversations it may read.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.message_pins (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages(id) on delete cascade,
  conversation_id  uuid not null,
  org_id           uuid not null,
  project_id       uuid not null,
  type             text not null,
  dm_contractor_id uuid,
  pinned_by        uuid not null references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (conversation_id, message_id)
);
create index if not exists message_pins_conversation_idx on public.message_pins (conversation_id, created_at desc);

-- Scope columns inherited from the message (same trigger as reactions/attachments).
create trigger message_pins_denormalize_trg before insert on public.message_pins
  for each row execute function public.child_denormalize();

alter table public.message_pins enable row level security;

create policy message_pins_select on public.message_pins for select
  using ((select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id)));

-- Any member of the conversation can pin (their own pin row).
create policy message_pins_insert on public.message_pins for insert
  with check (
    pinned_by = (select auth.uid())
    and (select public.can_access_chat(type, org_id, project_id, dm_contractor_id, conversation_id))
  );

-- The pinner or a manager can unpin.
create policy message_pins_delete on public.message_pins for delete
  using (
    pinned_by = (select auth.uid())
    or (select public.is_org_staff(org_id))
    or coalesce((select public.project_role(project_id)) = 'pm', false)
  );

alter publication supabase_realtime add table public.message_pins;
