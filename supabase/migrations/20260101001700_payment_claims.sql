-- ─────────────────────────────────────────────────────────────────────────────
-- Payment claims (progress applications)
--
-- A contractor's earnings already exist as payment_schedule draws (generated
-- from their awarded quote). This lets the assigned contractor *claim* a draw —
-- "apply for payment" — moving it from 'pending' to 'invoiced'. Finance/PM then
-- pay it ('paid'), which already exists. We reuse the 'invoiced' schedule_status
-- (previously unused) as the claimed/awaiting-payment state; no enum change.
--
-- The transition is done through a SECURITY DEFINER function, NOT a table policy,
-- so a contractor can only flip status + record the claim — never touch amount,
-- task_id, or push straight to 'paid'. Table writes stay staff/PM only.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.payment_schedule
  add column if not exists claimed_at  timestamptz,
  add column if not exists claimed_by  uuid references auth.users(id) on delete set null,
  add column if not exists claim_note  text;

-- Contractor raises a progress claim against their own pending draw.
create or replace function public.submit_payment_claim(p_schedule_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payment_schedule%rowtype;
begin
  select * into r from public.payment_schedule where id = p_schedule_id;
  if not found then
    raise exception 'Draw not found';
  end if;
  if r.task_id is null or not public.is_task_assignee(r.task_id) then
    raise exception 'Only the assigned contractor can claim this draw';
  end if;
  if r.status <> 'pending' then
    raise exception 'This draw has already been claimed';
  end if;

  update public.payment_schedule
     set status     = 'invoiced',
         claimed_at = now(),
         claimed_by = (select auth.uid()),
         claim_note = nullif(btrim(p_note), '')
   where id = p_schedule_id;
end;
$$;

grant execute on function public.submit_payment_claim(uuid, text) to authenticated;

-- Finance/PM can send a claim back (e.g. wrong milestone) — 'invoiced' → 'pending',
-- clearing the claim. Table RLS already restricts writes to staff/PM, so this is
-- a thin convenience that also wipes the claim metadata atomically.
create or replace function public.reject_payment_claim(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payment_schedule%rowtype;
begin
  select * into r from public.payment_schedule where id = p_schedule_id;
  if not found then
    raise exception 'Draw not found';
  end if;
  if not ((select public.is_org_staff(r.org_id)) or (select public.project_role(r.project_id)) = 'pm') then
    raise exception 'Only finance or the project manager can reject a claim';
  end if;
  if r.status <> 'invoiced' then
    raise exception 'Only a claimed draw can be rejected';
  end if;

  update public.payment_schedule
     set status     = 'pending',
         claimed_at = null,
         claimed_by = null,
         claim_note = null
   where id = p_schedule_id;
end;
$$;

grant execute on function public.reject_payment_claim(uuid) to authenticated;
