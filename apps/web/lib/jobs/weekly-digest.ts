import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { weeklyDigestEmail, appUrl } from '@/lib/email/templates';
import { weeklyUnsubToken } from '@/lib/jobs/digest-token';
import { composeWorkPulse, type WorkPulseData } from '@datumpro/shared/domain';

type Admin = ReturnType<typeof createAdminClient>;

// Cap on unbounded job selects so a runaway tenant can't blow the cron budget.
const JOB_ROW_CAP = 2000;
const warnIfCapped = (label: string, rows: readonly unknown[] | null | undefined) => {
  if ((rows?.length ?? 0) >= JOB_ROW_CAP) {
    console.warn(`[weekly-digest] ${label} hit the ${JOB_ROW_CAP}-row cap — results truncated`);
  }
};

type MemberRow = { org_id: string; user_id: string; role: string };
type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  planned_start_date: string | null;
  sla_status: string | null;
  assignee_id: string | null;
  actual_end_date: string | null;
  project_id: string;
  projects: { name: string | null } | { name: string | null }[] | null;
};

const projName = (p: TaskRow['projects']): string | null => (Array.isArray(p) ? p[0]?.name : p?.name) ?? null;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Everyone's per-user Work Pulse figures for one org, computed from arrays we
 *  loaded once (so the whole org is a handful of queries, not N×). */
function signalsFor(
  userId: string,
  role: string,
  tasks: TaskRow[],
  pmProjectIds: Set<string>,
  approvalsByProject: Map<string, number>,
  now: Date,
): Omit<WorkPulseData, 'firstName'> {
  const today = now.toISOString().slice(0, 10);
  const in2 = addDaysIso(today, 2);
  const in7 = addDaysIso(today, 7);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  let overdue = 0,
    notStarted = 0,
    dueToday = 0,
    dueSoon = 0,
    upcoming = 0,
    blocked = 0,
    completed = 0;
  let nextDeadline: string | null = null;
  const upcomingByProject = new Map<string, { name: string | null; n: number }>();

  for (const t of tasks) {
    if (t.assignee_id !== userId) continue;
    const done = t.status === 'done';
    if (!done && (t.status === 'blocked' || t.sla_status === 'blocked')) blocked++;
    if (done) {
      if (t.actual_end_date && t.actual_end_date >= weekAgo) completed++;
      continue;
    }
    if (t.status === 'todo' && t.planned_start_date && t.planned_start_date < today) notStarted++;
    if (t.due_date) {
      if (t.due_date < today) overdue++;
      else if (t.due_date === today) dueToday++;
      else if (t.due_date <= in2) dueSoon++;
      if (t.due_date >= today) {
        if (t.due_date <= in7) {
          upcoming++;
          const cur = upcomingByProject.get(t.project_id) ?? { name: projName(t.projects), n: 0 };
          cur.n++;
          upcomingByProject.set(t.project_id, cur);
        }
        if (!nextDeadline || t.due_date < nextDeadline) nextDeadline = t.due_date;
      }
    }
  }

  // Approvals waiting on this user as a manager: everything in the projects they
  // manage (owner/admin → all; otherwise the projects they PM).
  let pendingApprovals = 0;
  const managesAll = role === 'owner' || role === 'admin';
  for (const [projectId, count] of approvalsByProject) {
    if (managesAll || pmProjectIds.has(projectId)) pendingApprovals += count;
  }

  let top: { name: string | null; n: number } | null = null;
  for (const v of upcomingByProject.values()) if (!top || v.n > top.n) top = v;

  return {
    pendingApprovals,
    overdueTasks: overdue,
    notStartedTasks: notStarted,
    dueTodayTasks: dueToday,
    dueSoonTasks: dueSoon,
    upcomingTasks: upcoming,
    blockedTasks: blocked,
    completedThisWeek: completed,
    recentActivityCount: 0,
    userRecentlyActive: false,
    overallProgressPct: null,
    activeProjectName: top?.name ?? null,
    nextDeadlineIso: nextDeadline,
  };
}

async function resolveProfiles(
  admin: Admin,
  userIds: string[],
): Promise<Map<string, { email: string | null; name: string }>> {
  const out = new Map<string, { email: string | null; name: string }>();
  if (userIds.length === 0) return out;
  const { data } = await admin.from('profiles').select('id, email, display_name').in('id', userIds);
  for (const p of (data ?? []) as { id: string; email: string | null; display_name: string | null }[]) {
    out.set(p.id, { email: p.email, name: p.display_name || p.email?.split('@')[0] || 'there' });
  }
  return out;
}

/**
 * The Monday "your week" digest: a Work Pulse greeting by email, per member, per
 * org. Reuses the shared composeWorkPulse engine over the same real signals the
 * dashboard shows. Only active members who haven't opted out are emailed, and
 * only when they actually have something on this week.
 */
export async function runWeeklyDigest(now: Date = new Date()): Promise<{ recipients: number; emailed: number }> {
  const admin = createAdminClient();
  // Pin the greeting to Monday morning so it reads "Good morning" whatever hour
  // the cron fires at.
  const morning = new Date(now);
  morning.setHours(8, 0, 0, 0);

  const { data: memberData } = await admin
    .from('org_members')
    .select('org_id, user_id, role')
    .eq('status', 'active')
    .eq('weekly_digest_opt_in', true)
    .limit(JOB_ROW_CAP);
  const members = (memberData ?? []) as MemberRow[];
  warnIfCapped('org_members', members);
  if (members.length === 0) return { recipients: 0, emailed: 0 };

  const byOrg = new Map<string, MemberRow[]>();
  for (const m of members) {
    const arr = byOrg.get(m.org_id) ?? [];
    arr.push(m);
    byOrg.set(m.org_id, arr);
  }

  let recipients = 0;
  let emailed = 0;

  for (const [orgId, orgMembers] of byOrg) {
    // One batch of reads per org, then everything is computed in memory.
    const [tasksRes, pmRes, extRes, varRes, rfiRes, snagRes, aiRes] = await Promise.all([
      admin
        .from('tasks')
        .select('id, title, status, due_date, planned_start_date, sla_status, assignee_id, actual_end_date, project_id, projects(name)')
        .eq('org_id', orgId)
        .limit(JOB_ROW_CAP),
      admin.from('project_members').select('user_id, project_id').eq('org_id', orgId).eq('role', 'pm').limit(JOB_ROW_CAP),
      admin.from('task_extension_requests').select('project_id').eq('org_id', orgId).eq('status', 'pending').limit(JOB_ROW_CAP),
      admin.from('variation_orders').select('project_id').eq('org_id', orgId).eq('status', 'submitted').limit(JOB_ROW_CAP),
      admin.from('rfis').select('assignee_id, raised_by, status').eq('org_id', orgId).limit(JOB_ROW_CAP),
      admin.from('snags').select('assignee_id, raised_by, status').eq('org_id', orgId).limit(JOB_ROW_CAP),
      admin.from('action_items').select('assignee_id, status').eq('org_id', orgId).eq('status', 'open').limit(JOB_ROW_CAP),
    ]);

    const tasks = (tasksRes.data ?? []) as TaskRow[];
    warnIfCapped(`tasks (org ${orgId})`, tasks);
    warnIfCapped(`project_members (org ${orgId})`, pmRes.data);
    warnIfCapped(`task_extension_requests (org ${orgId})`, extRes.data);
    warnIfCapped(`variation_orders (org ${orgId})`, varRes.data);
    warnIfCapped(`rfis (org ${orgId})`, rfiRes.data);
    warnIfCapped(`snags (org ${orgId})`, snagRes.data);
    warnIfCapped(`action_items (org ${orgId})`, aiRes.data);

    // Approvals per project = submitted tasks + pending extensions + submitted variations.
    const approvalsByProject = new Map<string, number>();
    const bump = (pid: string) => approvalsByProject.set(pid, (approvalsByProject.get(pid) ?? 0) + 1);
    for (const t of tasks) if (t.status === 'submitted') bump(t.project_id);
    for (const e of (extRes.data ?? []) as { project_id: string }[]) bump(e.project_id);
    for (const v of (varRes.data ?? []) as { project_id: string }[]) bump(v.project_id);

    // Projects each user PMs (for non-owner/admin approval scoping).
    const pmByUser = new Map<string, Set<string>>();
    for (const r of (pmRes.data ?? []) as { user_id: string; project_id: string }[]) {
      const set = pmByUser.get(r.user_id) ?? new Set<string>();
      set.add(r.project_id);
      pmByUser.set(r.user_id, set);
    }

    // Register actions awaiting each user (RFIs, snags, to-dos), computed in memory.
    const reg = new Map<string, { rfisToAnswer: number; rfisToReview: number; snagsToFix: number; snagsToVerify: number; todos: number }>();
    const regFor = (userId: string) => {
      let r = reg.get(userId);
      if (!r) {
        r = { rfisToAnswer: 0, rfisToReview: 0, snagsToFix: 0, snagsToVerify: 0, todos: 0 };
        reg.set(userId, r);
      }
      return r;
    };
    for (const r of (rfiRes.data ?? []) as { assignee_id: string | null; raised_by: string | null; status: string }[]) {
      if (r.assignee_id && (r.status === 'open' || r.status === 'reopened')) regFor(r.assignee_id).rfisToAnswer++;
      else if (r.raised_by && r.status === 'answered') regFor(r.raised_by).rfisToReview++;
    }
    for (const s of (snagRes.data ?? []) as { assignee_id: string | null; raised_by: string | null; status: string }[]) {
      if (s.assignee_id && (s.status === 'open' || s.status === 'reopened')) regFor(s.assignee_id).snagsToFix++;
      else if (s.raised_by && s.status === 'fixed') regFor(s.raised_by).snagsToVerify++;
    }
    for (const a of (aiRes.data ?? []) as { assignee_id: string | null }[]) {
      if (a.assignee_id) regFor(a.assignee_id).todos++;
    }

    const profiles = await resolveProfiles(admin, orgMembers.map((m) => m.user_id));

    for (const m of orgMembers) {
      const profile = profiles.get(m.user_id);
      if (!profile?.email) continue;

      const s = signalsFor(m.user_id, m.role, tasks, pmByUser.get(m.user_id) ?? new Set(), approvalsByProject, morning);
      const rc = regFor(m.user_id);
      const registerTotal = rc.rfisToAnswer + rc.rfisToReview + rc.snagsToFix + rc.snagsToVerify + rc.todos;
      const hasSomething =
        s.overdueTasks + s.dueTodayTasks + s.dueSoonTasks + s.upcomingTasks + s.blockedTasks + s.pendingApprovals + s.completedThisWeek + registerTotal >
        0;
      if (!hasSomething) continue; // don't email a blank week

      recipients++;
      const firstName = profile.name.split(' ')[0] || profile.name;
      const greeting = composeWorkPulse({ firstName, ...s }, morning, { allowPlayful: false });

      const token = weeklyUnsubToken(m.user_id, orgId);
      const unsubscribeUrl = token ? `${appUrl()}/api/unsubscribe/weekly-digest?token=${encodeURIComponent(token)}` : undefined;

      const { subject, html } = weeklyDigestEmail({
        greeting: greeting.primary,
        insight: greeting.insight,
        glance: greeting.glance,
        overdue: s.overdueTasks,
        dueThisWeek: s.dueTodayTasks + s.dueSoonTasks + s.upcomingTasks,
        approvals: s.pendingApprovals,
        blocked: s.blockedTasks,
        completedThisWeek: s.completedThisWeek,
        nextDeadlineIso: s.nextDeadlineIso,
        rfisToAnswer: rc.rfisToAnswer,
        rfisToReview: rc.rfisToReview,
        snagsToFix: rc.snagsToFix,
        snagsToVerify: rc.snagsToVerify,
        todos: rc.todos,
        dashboardUrl: `${appUrl()}/dashboard`,
        unsubscribeUrl,
      });
      const r = await sendEmail({ to: profile.email, subject, html });
      if (r.ok) emailed++;
    }
  }

  return { recipients, emailed };
}
