-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — two-step approvals Stage 2: seed extension approval steps
--
-- Every new extension request gets its PM→Admin approval chain seeded on insert,
-- so the request itself carries no approval logic (and can't be short-circuited).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.seed_extension_approvals()
  returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  perform public.seed_approval_steps('extension', new.id, new.org_id, 0);
  return new;
end $function$;

create trigger on_extension_created_seed
  after insert on public.task_extension_requests
  for each row execute function public.seed_extension_approvals();
