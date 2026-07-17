import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { sendExpoPushToUsers } from '@/lib/notify/push';
import { appUrl } from '@/lib/email/templates';

type Admin = ReturnType<typeof createAdminClient>;

/** Deliver a reminder across all channels from the cron (service) context —
 *  direct insert (RLS-bypassing), email, and mobile push. Best-effort. */
async function deliver(
  admin: Admin,
  args: { orgId: string; userId: string; type: string; title: string; body: string; link: string; entityId: string },
): Promise<void> {
  // Don't re-nudge the same person about the same thing more than once a day.
  const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', args.userId)
    .eq('type', args.type)
    .eq('entity_id', args.entityId)
    .gte('created_at', cutoff);
  if ((count ?? 0) > 0) return;

  await admin
    .from('notifications')
    .insert({
      org_id: args.orgId,
      user_id: args.userId,
      type: args.type,
      title: args.title,
      body: args.body,
      link: args.link,
      entity_type: 'task',
      entity_id: args.entityId,
    })
    .then(() => {}, () => {});
  const { data } = await admin.from('profiles').select('email').eq('id', args.userId).single();
  const to = (data as { email: string | null } | null)?.email;
  if (to) {
    const url = `${appUrl()}${args.link}`;
    await sendEmail({
      to,
      subject: args.title,
      html: `<div style="font-family:system-ui,sans-serif"><h2 style="margin:0 0 8px">${args.title}</h2><p style="color:#3f3f46">${args.body}</p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">Open in DatumPro</a></div>`,
    }).catch(() => {});
  }
  await sendExpoPushToUsers([args.userId], { title: args.title, body: args.body, url: args.link });
}

/** Daily reminder scan: subtask steps due-soon/overdue and tasks still waiting
 *  on the contractor's acceptance. Nudges the responsible person on each. */
export async function runRemindersScan(now: Date = new Date()): Promise<{ sent: number }> {
  const admin = createAdminClient();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  let sent = 0;

  // 1. Subtask steps due today/tomorrow or already overdue (still open).
  const { data: subs } = await admin
    .from('task_subtasks')
    .select('id, title, planned_end_date, task_id')
    .eq('is_done', false)
    .not('planned_end_date', 'is', null)
    .lte('planned_end_date', tomorrow);
  const subList = (subs ?? []) as { id: string; title: string; planned_end_date: string; task_id: string }[];
  if (subList.length > 0) {
    const taskIds = [...new Set(subList.map((s) => s.task_id))];
    const { data: tasks } = await admin
      .from('tasks')
      .select('id, title, assignee_id, org_id, project_id, status')
      .in('id', taskIds);
    const tmap = new Map(
      ((tasks ?? []) as {
        id: string;
        title: string;
        assignee_id: string | null;
        org_id: string;
        project_id: string;
        status: string;
      }[]).map((t) => [t.id, t]),
    );
    for (const s of subList) {
      const t = tmap.get(s.task_id);
      if (!t || !t.assignee_id || t.status === 'done') continue;
      const overdue = s.planned_end_date < today;
      await deliver(admin, {
        orgId: t.org_id,
        userId: t.assignee_id,
        type: overdue ? 'subtask_overdue' : 'subtask_due',
        title: overdue ? 'A step is overdue' : 'A step is due soon',
        body: `“${s.title}” on ${t.title} ${overdue ? `was due ${s.planned_end_date}` : `is due ${s.planned_end_date}`}.`,
        link: `/projects/${t.project_id}/tasks/${t.id}`,
        entityId: t.id,
      });
      sent++;
    }
  }

  // 2. Tasks still waiting on the contractor's acceptance.
  const { data: pending } = await admin
    .from('tasks')
    .select('id, title, assignee_id, org_id, project_id')
    .eq('acceptance_status', 'pending')
    .not('assignee_id', 'is', null);
  for (const t of (pending ?? []) as {
    id: string;
    title: string;
    assignee_id: string;
    org_id: string;
    project_id: string;
  }[]) {
    await deliver(admin, {
      orgId: t.org_id,
      userId: t.assignee_id,
      type: 'task_accept_reminder',
      title: 'A task is waiting for your acceptance',
      body: `“${t.title}” is waiting for you to accept or decline.`,
      link: `/projects/${t.project_id}/tasks/${t.id}`,
      entityId: t.id,
    });
    sent++;
  }

  return { sent };
}
