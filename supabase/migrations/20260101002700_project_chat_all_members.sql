-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — project chat is for EVERY project member
--
-- Previously the project group chat was delivery-team only: contractors were
-- excluded unless a PM explicitly added them as a participant. Product change:
-- anyone who is a member of the project can use its chat — whether they have one
-- task, no tasks, or a finished task — for as long as the project (conversation)
-- is active. Access is RLS-driven, so this opens it on web AND mobile at once.
-- ─────────────────────────────────────────────────────────────────────────────

-- Access predicate: project chat now = any project member (or org staff, or an
-- explicit participant). task_dm rule is unchanged.
create or replace function public.can_access_chat(
  p_type text, p_org_id uuid, p_project_id uuid, p_dm_contractor uuid, p_conversation_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_type = 'task_dm' then
         public.is_org_staff(p_org_id)
      or public.project_role(p_project_id) = 'pm'
      or p_dm_contractor = (select auth.uid())
      or public.is_conversation_participant(p_conversation_id)
    else
         public.is_org_staff(p_org_id)
      or public.is_project_member(p_project_id)      -- every project member
      or public.is_conversation_participant(p_conversation_id)
  end;
$$;

-- Push recipients: whole project team for a project chat (contractors included);
-- kept in lockstep with the RLS predicate above.
create or replace function public.chat_recipients(p_conversation_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with c as (select * from public.conversations where id = p_conversation_id)
  select distinct u
  from (
    select om.user_id as u
    from c
    join public.org_members om on om.org_id = c.org_id
    where om.status = 'active' and om.role in ('owner', 'admin', 'finance')

    union
    -- project members: everyone for a project chat; only the PM for a task DM.
    select pm.user_id
    from c
    join public.project_members pm on pm.project_id = c.project_id
    where (c.type = 'project')
       or (c.type = 'task_dm' and pm.role = 'pm')

    union
    select c.contractor_id from c where c.type = 'task_dm' and c.contractor_id is not null

    union
    select cp.user_id
    from c
    join public.conversation_participants cp on cp.conversation_id = c.id
  ) s
  where u is not null;
$$;
