-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — invitee profile setup (snag spec §1.3/§1.4)
--
-- Profiles gain the fields the invite-acceptance setup screen collects:
-- a public handle, phone (WhatsApp-first for site contractors), optional
-- company + trade for external contractors, and avatar thumb/cache-bust
-- columns. Plus an `avatars` storage bucket (public read, own-folder write).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists username          text;
alter table public.profiles add column if not exists phone             text;
alter table public.profiles add column if not exists company_name      text;
alter table public.profiles add column if not exists trade             text;
alter table public.profiles add column if not exists avatar_thumb_url  text;
alter table public.profiles add column if not exists avatar_updated_at timestamptz;

-- Handles are lowercase and globally unique (case-insensitive). Format is
-- enforced app-side AND here so nothing unrenderable sneaks in.
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9._-]{3,30}$');

create unique index if not exists profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

-- Availability probe for the setup screen's live tick. SECURITY DEFINER because
-- profiles RLS only exposes users who share an org — a brand-new invitee shares
-- nothing yet but still needs collision checks to work.
create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_username ~ '^[a-z0-9._-]{3,30}$'
     and not exists (
       select 1 from public.profiles p
       where lower(p.username) = lower(p_username)
         and p.id is distinct from (select auth.uid())
     );
$$;

-- ── Avatars bucket ───────────────────────────────────────────────────────────
-- Public read (avatars render in chat/stacks without signed URLs; cache-bust
-- via avatar_updated_at). Writes are limited to the caller's own folder:
-- {user_id}/avatar.webp and {user_id}/thumb.webp.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars read"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

create policy "avatars upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
