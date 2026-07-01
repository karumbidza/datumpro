import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { digestEmail, appUrl } from '@/lib/email/templates';

interface TaskRow {
  id: string;
  title: string;
  due_date: string | null;
  project_id: string;
  assignee_id: string;
}

const OPEN = ['todo', 'in_progress', 'submitted', 'blocked']; // everything not done

/**
 * A per-person daily summary of open assigned work. Grouped by assignee so each
 * user gets one email regardless of how many projects/orgs they touch. Only
 * people with at least one open task are emailed.
 */
export async function runDailyDigest(now: Date = new Date()): Promise<{ recipients: number; emailed: number }> {
  const admin = createAdminClient();
  const today = now.toISOString().slice(0, 10);

  const { data } = await admin
    .from('tasks')
    .select('id, title, due_date, project_id, assignee_id')
    .not('assignee_id', 'is', null)
    .in('status', OPEN);
  const tasks = (data ?? []) as TaskRow[];
  if (tasks.length === 0) return { recipients: 0, emailed: 0 };

  // Group by assignee.
  const byUser = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const list = byUser.get(t.assignee_id) ?? [];
    list.push(t);
    byUser.set(t.assignee_id, list);
  }

  const emailByUser = await resolveProfiles(admin, [...byUser.keys()]);

  let emailed = 0;
  for (const [userId, userTasks] of byUser) {
    const profile = emailByUser.get(userId);
    if (!profile?.email) continue;

    const overdue = userTasks
      .filter((t) => t.due_date && t.due_date < today)
      .slice(0, 5)
      .map((t) => ({ title: t.title, url: `${appUrl()}/projects/${t.project_id}/tasks/${t.id}` }));
    const dueTodayCount = userTasks.filter((t) => t.due_date === today).length;

    const { subject, html } = digestEmail({
      name: profile.name,
      openCount: userTasks.length,
      overdue,
      dueTodayCount,
      dashboardUrl: `${appUrl()}/dashboard`,
    });
    const r = await sendEmail({ to: profile.email, subject, html });
    if (r.ok) emailed++;
  }

  return { recipients: byUser.size, emailed };
}

async function resolveProfiles(
  admin: ReturnType<typeof createAdminClient>,
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
