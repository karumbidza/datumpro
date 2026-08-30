-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — variation-order numbers + realtime
--
-- The variation_orders table has existed since the finance schema but was never
-- surfaced in the app. This adds a per-project running VO number (so the register
-- reads "VO #4") and puts the table on the realtime publication so the register
-- refreshes live. RLS is unchanged — the existing can_view_project /
-- can_manage_project policies already gate reads (members) and approve/reject
-- (managers), and approved rows stay delete-protected.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.variation_orders add column if not exists number int;

-- Backfill any existing rows per project, oldest first.
with numbered as (
  select id, row_number() over (partition by project_id order by created_at, id) as rn
    from public.variation_orders
)
update public.variation_orders v
   set number = n.rn
  from numbered n
 where v.id = n.id and v.number is null;

-- Per-project running number, serialised on the project so two VOs never collide.
create or replace function public.variation_orders_assign_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number
      from public.variation_orders where project_id = new.project_id;
  end if;
  return new;
end $$;

drop trigger if exists variation_orders_assign_number_trg on public.variation_orders;
create trigger variation_orders_assign_number_trg before insert on public.variation_orders
  for each row execute function public.variation_orders_assign_number();

-- One VO number per project.
alter table public.variation_orders
  drop constraint if exists variation_orders_project_number_key;
alter table public.variation_orders
  add constraint variation_orders_project_number_key unique (project_id, number);

-- Live updates on the register.
alter publication supabase_realtime add table public.variation_orders;
