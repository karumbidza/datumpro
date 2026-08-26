-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — audit service/system changes to org_members (privileged, invisible)
--
-- The cross-product admin adapter (/api/admin/*) changes member role/status via
-- the service role (RLS-bypassing) and writes NO audit event — so Mission Control
-- disabling a member or changing a role was invisible in the org's audit trail.
-- More generally, ANY service-role / direct-SQL change to a membership went
-- unrecorded.
--
-- This trigger audits exactly those unattributed changes (auth.uid() IS NULL:
-- service role, admin adapter, cron, psql). User-driven changes keep being
-- audited by the app layer as the acting admin, so there are no duplicates — this
-- only closes the gap. The trigger is SECURITY DEFINER so it can write audit_logs
-- (which has no INSERT policy by design). Very low risk: it no-ops for normal
-- app/user flows (handle_new_org, accept_org_invitation, member admin — all run
-- with auth.uid() set) and only fires for null-actor writes.
--
-- Validated in a rolled-back transaction: 4/4.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.audit_org_member_change()
  returns trigger language plpgsql security definer set search_path to '' as $function$
declare act text; bef jsonb; aft jsonb; rec record;
begin
  -- Only unattributed (service/system) changes; user changes are audited by the app.
  if (select auth.uid()) is not null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    act := 'member.removed';
    bef := jsonb_build_object('role', old.role::text, 'member_type', old.member_type::text, 'status', old.status::text);
    aft := jsonb_build_object('actor_kind', 'service');
    rec := old;
  elsif tg_op = 'INSERT' then
    act := 'member.added';
    bef := null;
    aft := jsonb_build_object('role', new.role::text, 'member_type', new.member_type::text, 'status', new.status::text, 'actor_kind', 'service');
    rec := new;
  else
    if new.role is not distinct from old.role
       and new.member_type is not distinct from old.member_type
       and new.status is not distinct from old.status then
      return new;  -- nothing privilege-relevant changed
    end if;
    act := case
      when new.status <> old.status and new.status = 'disabled' then 'member.disabled'
      when new.status <> old.status and new.status = 'active' and old.status = 'disabled' then 'member.enabled'
      when new.role <> old.role then 'member.role_changed'
      else 'member.updated' end;
    bef := jsonb_build_object('role', old.role::text, 'member_type', old.member_type::text, 'status', old.status::text);
    aft := jsonb_build_object('role', new.role::text, 'member_type', new.member_type::text, 'status', new.status::text, 'actor_kind', 'service');
    rec := new;
  end if;

  insert into public.audit_logs (org_id, actor_id, entity_type, entity_id, action, before, after)
  values (rec.org_id, null, 'org_member', rec.user_id, act, bef, aft);

  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists org_members_service_audit on public.org_members;
create trigger org_members_service_audit
  after insert or update or delete on public.org_members
  for each row execute function public.audit_org_member_change();
