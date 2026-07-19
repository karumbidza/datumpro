-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — two-step approvals Stage 2: requests (+ variation request-type)
--
-- submit_request seeded steps by request_type, but the shared engine's policies
-- are keyed by entity_type ('request'). Realign it so submitting a request seeds
-- the PM→Admin chain from those policies, tagging each approval with
-- entity_type/entity_id (and request_id for back-compat with the request UI).
-- Variations ride this same path (they're requests of type 'variation').
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_request(p_request_id uuid)
  returns void language plpgsql security definer set search_path to ''
as $function$
declare r public.requests; step int := 0;
begin
  select * into r from public.requests where id = p_request_id;
  if r.id is null then raise exception 'request not found'; end if;
  if not ((select auth.uid()) = r.raised_by
          or public.org_role(r.org_id) in ('owner', 'admin', 'pm')) then
    raise exception 'not allowed to submit this request';
  end if;
  if r.status <> 'draft' then raise exception 'request is not a draft'; end if;

  insert into public.approvals (org_id, request_id, entity_type, entity_id, step_order, approver_role, decision)
  select r.org_id, r.id, 'request', r.id, ap.step_order, ap.approver_role, 'pending'
  from public.approval_policies ap
  where ap.org_id = r.org_id and ap.entity_type = 'request'
    and coalesce(r.amount_cents, 0) >= coalesce(ap.min_amount_cents, 0)
  order by ap.step_order;
  get diagnostics step = row_count;

  -- No matching policy → nothing to approve → auto-approve.
  update public.requests
    set status = (case when step = 0 then 'approved' else 'submitted' end)::public.request_status,
        decided_at = case when step = 0 then now() else null end,
        updated_at = now()
    where id = r.id;
end;
$function$;
