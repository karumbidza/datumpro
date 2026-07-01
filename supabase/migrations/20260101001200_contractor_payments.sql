-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — contractor progress payments (buy-side)
--
-- When a quote is awarded, a payment schedule is generated from its terms
-- (advance / retention / balance-on-completion). Those draws are money owed to
-- the contractor, so they carry the same cost confidentiality as the quote:
-- visible only to company staff (owner/admin/finance), the project's PM, and the
-- contractor assigned to the task.
--
-- Uses the existing payment_schedule table (already task-linked); this migration
-- adds the columns progress billing needs and tightens its RLS from project-wide
-- to cost-confidential.
-- ─────────────────────────────────────────────────────────────────────────────

-- True if the current user is the assignee of the given task.
create or replace function public.is_task_assignee(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.assignee_id = (select auth.uid())
  );
$$;

alter table public.payment_schedule
  add column if not exists kind           text,       -- advance | progress | retention | completion
  add column if not exists paid_at        timestamptz,
  add column if not exists paid_reference text;

-- ── Cost confidentiality on the schedule ──
drop policy if exists payment_schedule_select on public.payment_schedule;
create policy payment_schedule_select on public.payment_schedule for select
  using (
    (select public.is_org_staff(org_id))                       -- owner/admin/finance
    or (select public.project_role(project_id)) = 'pm'         -- the project's PM
    or (task_id is not null and (select public.is_task_assignee(task_id)))  -- the assigned contractor
  );

-- Draws are created/updated by finance/admins or the project's PM.
drop policy if exists payment_schedule_write on public.payment_schedule;
create policy payment_schedule_write on public.payment_schedule for all
  using ((select public.is_org_staff(org_id)) or (select public.project_role(project_id)) = 'pm')
  with check ((select public.is_org_staff(org_id)) or (select public.project_role(project_id)) = 'pm');
