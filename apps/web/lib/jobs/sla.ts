import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { slaEmail, appUrl } from '@/lib/email/templates';

interface TaskRow {
  id: string;
  title: string;
  due_date: string | null;
  project_id: string;
  assignee_id: string | null;
  sla_status: string;
}

const ACTIVE = ['todo', 'in_progress']; // work in flight; not submitted/blocked/done

/** Today's date (UTC) as YYYY-MM-DD — due_date is a DATE column. */
function todayISO(now: Date): string {
  return now.toISOString().slice(0, 10);
}
function addDaysISO(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Time-driven SLA transitions the app can't make on user action:
 *   • active task past its due date        → breached  (notify assignee + PMs)
 *   • active task due today/tomorrow        → at_risk   (notify assignee)
 * Runs with the service role (all orgs). Idempotent: a task already in the target
 * state is not re-notified because the query only picks earlier states.
 */
export async function runSlaScan(now: Date = new Date()): Promise<{
  breached: number;
  atRisk: number;
  emailed: number;
}> {
  const admin = createAdminClient();
  const today = todayISO(now);
  const tomorrow = addDaysISO(now, 1);

  const [{ data: overdueData }, { data: soonData }] = await Promise.all([
    admin
      .from('tasks')
      .select('id, title, due_date, project_id, assignee_id, sla_status')
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .in('status', ACTIVE)
      .in('sla_status', ['on_track', 'at_risk']),
    admin
      .from('tasks')
      .select('id, title, due_date, project_id, assignee_id, sla_status')
      .not('due_date', 'is', null)
      .gte('due_date', today)
      .lte('due_date', tomorrow)
      .in('status', ACTIVE)
      .eq('sla_status', 'on_track'),
  ]);

  const breachedTasks = (overdueData ?? []) as TaskRow[];
  const atRiskTasks = (soonData ?? []) as TaskRow[];

  // Flip the states in two bulk updates.
  if (breachedTasks.length) {
    await admin
      .from('tasks')
      .update({ sla_status: 'breached' })
      .in('id', breachedTasks.map((t) => t.id));
  }
  if (atRiskTasks.length) {
    await admin
      .from('tasks')
      .update({ sla_status: 'at_risk' })
      .in('id', atRiskTasks.map((t) => t.id));
  }

  // Resolve emails: assignees (both sets) + PMs (breached projects only).
  const assigneeIds = [
    ...new Set([...breachedTasks, ...atRiskTasks].map((t) => t.assignee_id).filter(Boolean) as string[]),
  ];
  const breachedProjectIds = [...new Set(breachedTasks.map((t) => t.project_id))];

  const [emailByUser, pmsByProject] = await Promise.all([
    resolveEmails(admin, assigneeIds),
    resolveProjectPMs(admin, breachedProjectIds),
  ]);

  let emailed = 0;
  const send = async (to: string | undefined, msg: { subject: string; html: string }) => {
    if (!to) return;
    const r = await sendEmail({ to, subject: msg.subject, html: msg.html });
    if (r.ok) emailed++;
  };

  for (const t of atRiskTasks) {
    const url = `${appUrl()}/projects/${t.project_id}/tasks/${t.id}`;
    await send(
      t.assignee_id ? emailByUser.get(t.assignee_id) : undefined,
      slaEmail({ taskTitle: t.title, kind: 'at_risk', dueDate: t.due_date, url }),
    );
  }
  for (const t of breachedTasks) {
    const url = `${appUrl()}/projects/${t.project_id}/tasks/${t.id}`;
    const msg = slaEmail({ taskTitle: t.title, kind: 'breached', dueDate: t.due_date, url });
    // assignee + every PM of the project, de-duplicated
    const recipients = new Set<string>();
    if (t.assignee_id) {
      const e = emailByUser.get(t.assignee_id);
      if (e) recipients.add(e);
    }
    for (const pmEmail of pmsByProject.get(t.project_id) ?? []) recipients.add(pmEmail);
    for (const to of recipients) await send(to, msg);
  }

  return { breached: breachedTasks.length, atRisk: atRiskTasks.length, emailed };
}

async function resolveEmails(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const { data } = await admin.from('profiles').select('id, email').in('id', userIds);
  for (const p of (data ?? []) as { id: string; email: string | null }[]) {
    if (p.email) out.set(p.id, p.email);
  }
  return out;
}

async function resolveProjectPMs(
  admin: ReturnType<typeof createAdminClient>,
  projectIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (projectIds.length === 0) return out;
  const { data } = await admin
    .from('project_members')
    .select('project_id, profiles(email)')
    .in('project_id', projectIds)
    .eq('role', 'pm');
  for (const row of (data ?? []) as {
    project_id: string;
    profiles: { email: string | null } | { email: string | null }[] | null;
  }[]) {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (p?.email) {
      const list = out.get(row.project_id) ?? [];
      list.push(p.email);
      out.set(row.project_id, list);
    }
  }
  return out;
}
