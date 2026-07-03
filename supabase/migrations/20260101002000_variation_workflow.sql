-- ─────────────────────────────────────────────────────────────────────────────
-- Variation-order workflow (change orders)
--
-- A variation records a proposed change to a project's cost/time (a change
-- order). Until now the table only allowed owner/admin/PM to write, so a
-- contractor couldn't raise one. Add a 'submitted' state and let any project
-- member propose their own variation; only a manager (can_manage_project)
-- decides it. Managers may still create a variation in any state directly.
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.variation_status add value if not exists 'submitted';

-- Track who decided, for the audit trail (created_by already records the raiser).
alter table public.variation_orders
  add column if not exists decided_at timestamptz;

-- Replace the manager-only blanket write with split policies:
--   • INSERT — a project member raises their own; non-managers are forced to
--     'submitted' (they can't self-approve), managers may pick any state.
--   • UPDATE / DELETE — managers only (approve / reject / edit / remove).
drop policy if exists variation_orders_write on public.variation_orders;

create policy variation_orders_insert on public.variation_orders for insert
  with check (
    (select public.can_view_project(project_id, org_id))
    and created_by = (select auth.uid())
    and ((select public.can_manage_project(project_id, org_id)) or status = 'submitted')
  );

create policy variation_orders_update on public.variation_orders for update
  using ((select public.can_manage_project(project_id, org_id)))
  with check ((select public.can_manage_project(project_id, org_id)));

create policy variation_orders_delete on public.variation_orders for delete
  using ((select public.can_manage_project(project_id, org_id)));
