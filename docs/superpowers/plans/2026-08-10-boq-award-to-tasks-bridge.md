# Award → costed-tasks bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert an awarded BOQ tender into a delivery project + tasks/subtasks assigned to the winning contractor, seeded with the winning bid rates, so the contractor ticks each BOQ line to completion.

**Architecture:** One atomic SECURITY DEFINER RPC `export_award_to_project(...)` performs the whole conversion (create/resolve project → onboard winner as org+project contractor → generate one task per BOQ section + one costed subtask per priced line → link the tender). A staff-only "Start delivery" dialog + server action calls it. The contractor works the tasks through existing delivery screens (no new contractor UI). One new column `boq_tenders.awarded_project_id` provides the idempotency guard + delivery link.

**Tech Stack:** Supabase Postgres/PL-pgSQL (migration via MCP `apply_migration`), Next.js App Router server actions/components, TypeScript. Verification: rolled-back RPC E2E sims via MCP `execute_sql`, `supabase/tests/rls_security.sql`, `pnpm turbo run typecheck lint`. **No JS test harness.**

**Spec:** `docs/superpowers/specs/2026-08-10-boq-award-to-tasks-bridge-design.md`

**Confirmed schema facts:** unique constraints `org_members(org_id,user_id)`, `project_members(project_id,user_id)`, `boqs(id,org_id)`; `tasks` NOT NULL = `org_id,project_id,title` (rest default/nullable; `acceptance_status`,`plan_approved_at`,`awarded_cost_cents` nullable); `task_subtasks` NOT NULL = `org_id,task_id,title` (`cost_cents` default 0; `est_qty`,`est_unit` nullable); `projects` NOT NULL = `org_id,name`; `on_project_created` trigger auto-enrols the creator as PM.

---

### Task 1: DB — `awarded_project_id` column + `export_award_to_project` RPC

**Files:**
- Create: `supabase/migrations/<timestamp>_export_award_to_project.sql` (timestamp from MCP apply; name it `export_award_to_project`). Locally name it `20260101008800_export_award_to_project.sql`.
- Modify: `supabase/tests/rls_security.sql` (append assertions)

**NOTE (controller-executed):** This task is applied to prod via Supabase MCP and verified with a rolled-back E2E sim by the controller, not delegated.

- [ ] **Step 1: Write the migration SQL**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — award→delivery bridge: link column + export RPC.
-- Converts an AWARDED boq_tender into a project + tasks/subtasks assigned to the
-- winning contractor, seeded from their winning bid. Idempotent via awarded_project_id.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boq_tenders
  add column if not exists awarded_project_id uuid,
  add constraint boq_tenders_awarded_project_fk
    foreign key (awarded_project_id, org_id)
    references public.projects (id, org_id) on delete set null;

create or replace function public.export_award_to_project(
  p_tender_id uuid,
  p_project_id uuid default null,
  p_new_project_name text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_status text; v_bidder uuid; v_existing_proj uuid; v_boq uuid;
  v_winner uuid; v_boq_name text;
  v_project uuid; v_created_new boolean := false;
  v_section record; v_line record;
  v_task uuid; v_task_total bigint; v_grand_total bigint := 0;
  v_sec_no int := 0; v_line_no int; v_line_cost bigint;
begin
  select org_id, status::text, awarded_bidder_id, awarded_project_id, boq_id
    into v_org, v_status, v_bidder, v_existing_proj, v_boq
    from public.boq_tenders where id = p_tender_id;
  if v_org is null then raise exception 'tender not found'; end if;
  if not (public.is_org_admin(v_org) or public.org_role(v_org) = 'pm') then
    raise exception 'not authorised';
  end if;
  if v_status <> 'awarded' then raise exception 'tender is not awarded'; end if;
  if v_existing_proj is not null then raise exception 'tender already exported to a project'; end if;
  if v_bidder is null then raise exception 'tender has no awarded bidder'; end if;

  select user_id into v_winner from public.boq_bidders where id = v_bidder;
  if v_winner is null then raise exception 'awarded bidder has no linked user account'; end if;

  -- Project: existing (validate org) or new (named from BOQ).
  if p_project_id is not null then
    select id into v_project from public.projects where id = p_project_id and org_id = v_org;
    if v_project is null then raise exception 'target project not found in this organisation'; end if;
  else
    select name into v_boq_name from public.boqs where id = v_boq;
    insert into public.projects (org_id, name, status, created_by)
      values (v_org,
              coalesce(nullif(trim(p_new_project_name), ''), nullif(trim(v_boq_name), ''), 'Awarded works'),
              'active', (select auth.uid()))
      returning id into v_project;
    v_created_new := true;
  end if;

  -- Onboard the winner (idempotent).
  insert into public.org_members (org_id, user_id, role, member_type, status)
    values (v_org, v_winner, 'member', 'contractor', 'active')
    on conflict (org_id, user_id) do nothing;
  insert into public.project_members (org_id, project_id, user_id, role)
    values (v_org, v_project, v_winner, 'contractor')
    on conflict (project_id, user_id) do nothing;

  -- One task per section that has at least one priced line for the winner.
  for v_section in
    select s.id, s.name, s.position
    from public.boq_sections s
    where s.boq_id = v_boq
    order by s.position
  loop
    if not exists (
      select 1 from public.boq_items i
      join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
      where i.section_id = v_section.id and bi.no_bid = false and bi.rate_cents is not null
    ) then
      continue;
    end if;

    v_sec_no := v_sec_no + 1;
    insert into public.tasks
      (org_id, project_id, title, assignee_id, acceptance_status, plan_approved_at, requires_photo_on_complete)
      values (v_org, v_project, v_sec_no || '. ' || v_section.name, v_winner, 'accepted', now(), false)
      returning id into v_task;

    v_task_total := 0;
    v_line_no := 0;
    for v_line in
      select i.description, i.uom, i.qty, i.position, bi.rate_cents
      from public.boq_items i
      join public.boq_bid_items bi on bi.boq_item_id = i.id and bi.bidder_id = v_bidder
      where i.section_id = v_section.id and bi.no_bid = false and bi.rate_cents is not null
      order by i.position
    loop
      v_line_no := v_line_no + 1;
      v_line_cost := round(v_line.qty * v_line.rate_cents)::bigint;
      insert into public.task_subtasks (org_id, task_id, title, cost_cents, position)
        values (
          v_org, v_task,
          v_sec_no || '.' || v_line_no || ' ' || v_line.description
            || case when v_line.uom is not null and trim(v_line.uom) <> ''
                    then ' — ' || trim(to_char(v_line.qty, 'FM999999990.####')) || ' ' || v_line.uom
                    else '' end,
          v_line_cost, v_line_no - 1
        );
      v_task_total := v_task_total + v_line_cost;
    end loop;

    -- Force final state (belt-and-braces vs set_task_pending_on_assign trigger) + lock cost.
    update public.tasks
      set awarded_cost_cents = v_task_total, acceptance_status = 'accepted', plan_approved_at = now()
      where id = v_task;
    v_grand_total := v_grand_total + v_task_total;
  end loop;

  update public.boq_tenders set awarded_project_id = v_project, updated_at = now() where id = p_tender_id;
  if v_created_new then
    update public.projects set contract_value_cents = v_grand_total where id = v_project;
  end if;

  return v_project;
end $$;
revoke all on function public.export_award_to_project(uuid, uuid, text) from public;
grant execute on function public.export_award_to_project(uuid, uuid, text) to authenticated;
```

- [ ] **Step 2: Apply via MCP `apply_migration`** with name `export_award_to_project` and the Step 1 SQL. Save the file locally with the returned timestamp (or `20260101008800`). Expected: success. If the `alter table` errors because `set_task_pending_on_assign` or an enum value name differs, read the error and adjust (e.g. verify `project_role` enum has `'contractor'` and `member_type` has `'contractor'` — both confirmed).

- [ ] **Step 3: Rolled-back E2E sim (MCP `execute_sql`)** — one `DO` block that (with `session_replication_role = replica` during seeding) creates: an org, a staff user (admin) + a contractor user; a BOQ with **2 sections**, section 1 with 2 items, section 2 with 1 item; a tender `status='awarded'` with the contractor as a `submitted` bidder whose `boq_bid_items` price 2 of the 3 lines (one line `no_bid=true`, one item with a rate, and leave section-2's only line **priced** so both sections produce a task — actually: make section-1 have one priced + one `no_bid`, section-2 have its one line priced). Then `set local role authenticated` as the staff user and call `export_award_to_project(tender, null, 'Test Project')`. Assert (raise a summary at the end, forcing rollback):
  - a project exists named 'Test Project', `status='active'`;
  - winner is now `org_members.member_type='contractor'` and `project_members.role='contractor'`;
  - exactly **2 tasks** (one per section), each `acceptance_status='accepted'`, `plan_approved_at not null`, `requires_photo_on_complete=false`, `assignee_id = winner`;
  - section-1 task has exactly **1 subtask** (the `no_bid` line excluded), section-2 task has 1 subtask;
  - each subtask `cost_cents = round(qty*rate)`; each task `awarded_cost_cents` = its subtask sum; project `contract_value_cents` = grand total;
  - `boq_tenders.awarded_project_id` is set.
  Then call the RPC **again** and confirm it raises `already exported`. Then (fresh tx) call as a **non-staff** user and confirm it raises `not authorised`.

- [ ] **Step 4: Add assertions to `supabase/tests/rls_security.sql`** — append a section that (using the suite's superuser-seed + `set role authenticated` style) seeds a minimal awarded tender in org A and asserts the three headline invariants that don't require the full DO harness: (i) a non-staff/outsider calling `export_award_to_project` raises (wrap in a `do$$ … exception when others` PASS block), (ii) after a staff export the tender's `awarded_project_id` is set and the winner is a `project_members` contractor, (iii) a second export raises. Match the file's `pg_temp.ok(...)` convention.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/ supabase/tests/rls_security.sql
git commit -m "feat(boq): export_award_to_project RPC + awarded_project_id link

Converts an awarded BOQ tender into a project + costed tasks/subtasks assigned to
the winning contractor (auto-enrolled). Idempotent via boq_tenders.awarded_project_id.
Verified with rolled-back E2E sim + rls_security.sql assertions.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Data layer — surface `awardedProjectId` + org projects list

**Files:**
- Modify: `apps/web/lib/data/tender.ts` (`getTenderOwnerExtras` at ~466-472; add `listOrgProjects`)

- [ ] **Step 1: Extend `getTenderOwnerExtras`** to also return the tender's `awardedProjectId` and the delivery project's name (for the "View delivery project" link). Replace the function body:

```ts
export async function getTenderOwnerExtras(
  tenderId: string,
): Promise<{ unsealEligible: boolean; awardedProjectId: string | null; awardedProjectName: string | null }> {
  const supabase = await createClient();
  const [{ data: elig }, { data: tenderRow }] = await Promise.all([
    supabase.rpc('tender_unseal_eligible', { p_tender_id: tenderId }),
    supabase
      .from('boq_tenders')
      .select('awarded_project_id, projects:awarded_project_id(name)')
      .eq('id', tenderId)
      .maybeSingle(),
  ]);
  const row = tenderRow as unknown as {
    awarded_project_id: string | null;
    projects: { name: string } | { name: string }[] | null;
  } | null;
  const proj = row ? (Array.isArray(row.projects) ? row.projects[0] : row.projects) : null;
  return {
    unsealEligible: !!elig,
    awardedProjectId: row?.awarded_project_id ?? null,
    awardedProjectName: proj?.name ?? null,
  };
}
```
If the embedded `projects:awarded_project_id(name)` alias does not resolve under PostgREST (no declared FK relationship name), fall back to a second explicit query: fetch `awarded_project_id` first, then `select name from projects where id = awardedProjectId` when non-null. Verify which works by reasoning about the FK name; prefer the single query if valid.

- [ ] **Step 2: Add `listOrgProjects`** (for the existing-project picker). Append to `tender.ts` (or reuse an existing project-list helper if one already exists in `lib/data/projects.ts` — check first and reuse rather than duplicate):

```ts
export async function listOrgProjects(orgId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('projects')
    .select('id, name')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  return (data ?? []) as { id: string; name: string }[];
}
```

- [ ] **Step 3: Typecheck** — `pnpm turbo run typecheck --filter=@datumpro/web`. Expected: PASS (consumers of `getTenderOwnerExtras` only read `unsealEligible` today, so widening the return type is safe).

- [ ] **Step 4: Commit**
```bash
git add apps/web/lib/data/tender.ts
git commit -m "feat(boq): surface awardedProjectId + listOrgProjects for delivery export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Winner notification email

**Files:**
- Create: `apps/web/lib/email/tender-delivery.ts`

- [ ] **Step 1: Write the email helper** — mirror the inline-HTML style of `apps/web/lib/email/tender-award.ts` (read it first to match the exact card markup/colours). Export:

```ts
import 'server-only';

/** Email to the winning contractor when their awarded tender is exported to a
 *  delivery project and tasks are assigned. Best-effort; mirrors tender-award.ts. */
export function deliveryAssignedEmail(input: {
  orgName: string;
  projectName: string;
  taskCount: number;
}): { subject: string; html: string } {
  const { orgName, projectName, taskCount } = input;
  const subject = `Work assigned: ${projectName}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
        <tr><td style="padding:18px 24px;border-bottom:1px solid #f4f4f5;font-weight:700;font-size:15px;color:#18181b">DatumPro</td></tr>
        <tr><td style="padding:24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:18px;font-weight:600;color:#18181b;padding-bottom:8px">Your work is ready</td></tr>
            <tr><td style="font-size:14px;color:#3f3f46;line-height:1.5;padding-bottom:14px">
              <strong>${orgName}</strong> has assigned you the works for &ldquo;${projectName}&rdquo; on DatumPro
              (${taskCount} task${taskCount === 1 ? '' : 's'}). Log in to view your tasks, see the agreed costs,
              and tick off each item as you complete it.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #f4f4f5;font-size:11px;color:#a1a1aa">
          You're receiving this because ${orgName} assigned you work through DatumPro.
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  return { subject, html };
}
```

- [ ] **Step 2: Typecheck** — `pnpm turbo run typecheck --filter=@datumpro/web`. Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add apps/web/lib/email/tender-delivery.ts
git commit -m "feat(boq): winner delivery-assigned email template

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `startDelivery` action + "Start delivery" UI

**Files:**
- Modify: `apps/web/app/(app)/boq/[boqId]/tender/actions.ts` (add `startDelivery`)
- Create: `apps/web/app/(app)/boq/[boqId]/tender/start-delivery.tsx` (client dialog)
- Modify: `apps/web/app/(app)/boq/[boqId]/tender/page.tsx` (pass projects + awarded-project info; render the control) and/or `comparison.tsx` — read both first to decide the cleanest seam.

- [ ] **Step 1: Add the `startDelivery` server action** to `actions.ts` (reuse the file's existing `requireOrg`, `isRedirect`, `sendEmail`, `revalidatePath`, `redirect` helpers/imports; add imports for `deliveryAssignedEmail` from `@/lib/email/tender-delivery`):

```ts
export async function startDelivery(formData: FormData): Promise<void> {
  const { supabase, orgId } = await requireOrg();
  const tenderId = String(formData.get('tenderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const mode = String(formData.get('mode') ?? 'new');
  const projectName = String(formData.get('projectName') ?? '');
  const projectId = String(formData.get('projectId') ?? '');

  const { data: newProjectId, error } = await supabase.rpc('export_award_to_project', {
    p_tender_id: tenderId,
    p_project_id: mode === 'existing' && projectId ? projectId : null,
    p_new_project_name: mode === 'new' ? projectName : null,
  });
  if (error) throw new Error(error.message);
  const projId = newProjectId as unknown as string;

  // Best-effort: notify the winning contractor.
  try {
    const [{ data: org }, { data: tender }, { data: taskCountRow }, { data: proj }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', orgId).single(),
      supabase.from('boq_tenders').select('awarded_bidder_id').eq('id', tenderId).single(),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', projId),
      supabase.from('projects').select('name').eq('id', projId).single(),
    ]);
    const awardedBidderId = (tender as { awarded_bidder_id?: string } | null)?.awarded_bidder_id ?? '';
    const { data: bidder } = await supabase
      .from('boq_bidders').select('contact_email').eq('id', awardedBidderId).single();
    const email = (bidder as { contact_email?: string } | null)?.contact_email;
    if (email) {
      const { subject, html } = deliveryAssignedEmail({
        orgName: (org as { name?: string } | null)?.name ?? 'DatumPro',
        projectName: (proj as { name?: string } | null)?.name ?? 'your project',
        taskCount: (taskCountRow as unknown as { length?: number } | null)?.length ?? 0,
      });
      await sendEmail({ to: email, subject, html });
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('[tender] delivery email failed:', e);
  }

  revalidatePath(`/boq/${boqId}/tender`);
  redirect(`/projects/${projId}/tasks`);
}
```
Note: the `head:true` count returns the count on the response's `count` field, not `.length`. Use the count properly — fetch it as `{ count }` from the destructured response instead of the row. Adjust to: `const { count: taskCount } = await supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', projId);` and pass `taskCount ?? 0`. (Implement it this correct way; the block above is the shape.)

- [ ] **Step 2: Build the dialog** `start-delivery.tsx` (client component). Props: `{ tenderId, boqId, projects }`. A "Start delivery →" button that opens a small inline form (radio: New project / Add to existing; a text input for the new name defaulting to something sensible; a `<select>` of `projects` for existing) posting to `startDelivery` via a `<form action={startDelivery}>`. Match the styling idiom of the sibling forms in `comparison.tsx`/`bidders-panel.tsx` (Button, inputs). Keep it self-contained. Include hidden inputs `tenderId`, `boqId`, and `mode` driven by the radio.

- [ ] **Step 3: Render it (staff-only, awarded, not-yet-exported)** in the owner tender view. Read `page.tsx` to see how `getTenderOwnerExtras` + `getTenderComparison` are consumed and how `canManage` is derived, then: fetch `listOrgProjects(orgId)` and pass `projects` + `awardedProjectId`/`awardedProjectName` down. Where the comparison shows an awarded tender:
  - if `canManage && status === 'awarded' && !awardedProjectId` → render `<StartDelivery tenderId boqId projects />`.
  - if `awardedProjectId` → render a link `View delivery project →` to `/projects/${awardedProjectId}/tasks` (label with `awardedProjectName` when present).
  Non-managers see neither.

- [ ] **Step 4: Typecheck + lint** — `pnpm turbo run typecheck lint --filter=@datumpro/web`. Expected: PASS. Fix any issues properly (no `any`/`@ts-ignore`).

- [ ] **Step 5: Manual verification (by inspection)** — confirm: the button shows only for staff on an awarded, not-exported tender; submitting New creates a project and redirects to its tasks; after export the view shows "View delivery project"; the email send is wrapped best-effort.

- [ ] **Step 6: Commit**
```bash
git add "apps/web/app/(app)/boq/[boqId]/tender/actions.ts" "apps/web/app/(app)/boq/[boqId]/tender/start-delivery.tsx" "apps/web/app/(app)/boq/[boqId]/tender/page.tsx"
git commit -m "feat(boq): Start delivery — export awarded tender to a project from the UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `awarded_project_id` column + composite FK → Task 1 Step 1. ✓
- `export_award_to_project` RPC (auth, guards, project new/existing, winner onboarding, section→task, priced-line→subtask, exclude no_bid, cost seeding, awarded_cost_cents, idempotency link, contract value) → Task 1 Step 1. ✓
- Auto-accept + plan pre-approved → RPC sets `acceptance_status='accepted'`, `plan_approved_at=now()`. ✓
- Idempotency + staff-only + E2E → Task 1 Steps 3-4. ✓
- Surface awardedProjectId + projects picker data → Task 2. ✓
- Best-effort winner email → Task 3 + Task 4 Step 1. ✓
- Start-delivery dialog (new/existing) + View-delivery-project + staff-only → Task 4 Steps 2-3. ✓
- No new contractor UI → confirmed (contractor reuses existing task screens; no task touches contractor views). ✓

**Placeholder scan:** No TBD/TODO. Migration timestamp resolved at apply (Task 1 Step 2). Task 4 Step 1 explicitly corrects the count-usage; Step 2/3 give exact behavior + props with a read-first integration seam (justified — the UI seam depends on the current file structure). ✓

**Type consistency:** `export_award_to_project(uuid,uuid,text)` signature identical in RPC, grant, and action call. `getTenderOwnerExtras` widened return (`awardedProjectId`,`awardedProjectName`) consumed in Task 4 Step 3. `startDelivery` form fields (`tenderId`,`boqId`,`mode`,`projectName`,`projectId`) match between action (Task 4 Step 1) and dialog (Task 4 Step 2). `deliveryAssignedEmail({orgName,projectName,taskCount})` identical in Task 3 and Task 4. ✓
