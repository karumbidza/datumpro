-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — to-dos: urgency, assignee-only completion, and urgency-paced reminders
--
-- Builds on action_items (20260826000028). Three additions:
--   1. urgency — low / normal / high / urgent — drives a coloured chip, the
--      urgent-first list order, and the reminder cadence below.
--   2. Assignee-only completion — when a to-do HAS an assignee, only that
--      assignee (or a manager / PM) may flip it to 'done'. The raiser can still
--      edit / reassign / reopen / remove it, just not tick off someone else's work.
--   3. In-app reminders — a daily pg_cron sweep re-nudges the assignee of an open
--      to-do on a cadence set by its urgency, until it is done.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 ── urgency + reminder bookkeeping ────────────────────────────────────────
alter table public.action_items
  add column if not exists urgency text not null default 'normal'
    check (urgency in ('low', 'normal', 'high', 'urgent'));
alter table public.action_items
  add column if not exists last_reminded_at timestamptz;

create index if not exists action_items_urgency_idx
  on public.action_items (project_id, urgency);

-- 2 ── assignee-only completion ──────────────────────────────────────────────
-- The action_items UPDATE policy already lets the assignee, the raiser, or a
-- manager write the row. This narrows just the completion transition: an
-- assigned to-do can only be ticked off by its assignee (managers/PM override).
create or replace function public.guard_action_item_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done'
     and new.assignee_id is not null then
    if (select auth.uid()) = new.assignee_id
       or (select public.is_org_staff(new.org_id))
       or coalesce((select public.project_role(new.project_id)) = 'pm', false) then
      return new;
    end if;
    raise exception 'Only the assignee can complete an assigned to-do';
  end if;
  return new;
end;
$$;

drop trigger if exists action_item_completion_guard on public.action_items;
create trigger action_item_completion_guard
  before update on public.action_items
  for each row execute function public.guard_action_item_completion();

-- 3 ── in-app reminders, paced by urgency ────────────────────────────────────
-- One sweep re-notifies every open, assigned to-do whose time since its last
-- nudge (or creation) has reached its urgency's cadence. Inserts straight into
-- notifications (definer) so it is in-app only — no email / push on the cadence.
create or replace function public.remind_open_action_items()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select ai.id, ai.org_id, ai.project_id, ai.title, ai.assignee_id, ai.due_date, ai.urgency,
           p.name as project_name
    from public.action_items ai
    join public.projects p on p.id = ai.project_id
    where ai.status = 'open'
      and ai.assignee_id is not null
      and now() - coalesce(ai.last_reminded_at, ai.created_at) >=
          (case ai.urgency
             when 'urgent' then interval '1 day'
             when 'high'   then interval '2 days'
             when 'low'    then interval '7 days'
             else interval '4 days'          -- normal
           end)
  loop
    insert into public.notifications (org_id, user_id, type, title, body, link, entity_type, entity_id)
    values (
      r.org_id, r.assignee_id, 'action_item_reminder',
      'Reminder: ' || r.title,
      case when r.due_date is not null
           then 'Still open on ' || r.project_name || ' — due ' || to_char(r.due_date, 'Mon DD')
           else 'Still open on ' || r.project_name end,
      '/projects/' || r.project_id || '/chat',
      'task', r.id
    );
    update public.action_items set last_reminded_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Daily sweep at 08:00 UTC (~10:00 in ZW). It self-gates by cadence, so running
-- daily gives urgent → every day, high → every 2 days, normal → 4, low → 7.
-- Guarded: if pg_cron is unavailable (e.g. a local shadow db) the migration
-- still succeeds — the function exists and the job can be scheduled later.
do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'remind-action-items') then
    perform cron.unschedule('remind-action-items');
  end if;
  perform cron.schedule('remind-action-items', '0 8 * * *', $cron$ select public.remind_open_action_items(); $cron$);
exception when others then
  raise notice 'pg_cron unavailable — reminder sweep not scheduled (%). Function remind_open_action_items() still exists.', sqlerrm;
end;
$$;
