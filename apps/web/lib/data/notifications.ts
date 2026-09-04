import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { emailUser } from '@/lib/email/notify';
import { appUrl } from '@/lib/email/templates';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as {
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    read_at: string | null;
    created_at: string;
  }[]).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

export async function unreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  return count ?? 0;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function notifHtml(title: string, body: string | undefined, link: string | undefined): string {
  const url = link ? `${appUrl()}${link}` : appUrl();
  return `<div style="font-family:system-ui,sans-serif">
    <h2 style="margin:0 0 8px">${title}</h2>
    ${body ? `<p style="color:#3f3f46;margin:0 0 16px">${body}</p>` : ''}
    <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">Open in DatumPro</a>
  </div>`;
}

/** Emit a notification to one user across all channels: in-app (bell), email,
 *  and — via the notifications-INSERT trigger → notification-push Edge Function —
 *  mobile/web push. We only write the row + send the email here; the phone push
 *  is fanned out at the database so every origin (web, mobile, cron) reaches the
 *  device through one path. Best-effort — never lets a delivery failure break the
 *  workflow that triggered it. */
export async function notifyUser(
  supabase: SupabaseClient,
  args: { orgId: string; userId: string; type: string; title: string; body?: string; link?: string; entityId?: string },
): Promise<void> {
  // In-app (guarded SQL helper) — cheap, keep on the request path so the bell is
  // up to date immediately.
  try {
    await supabase.rpc('notify', {
      p_org: args.orgId,
      p_user: args.userId,
      p_type: args.type,
      p_title: args.title,
      p_body: args.body ?? null,
      p_link: args.link ?? null,
      p_entity_type: 'task',
      p_entity_id: args.entityId ?? null,
    });
  } catch {
    /* swallow */
  }
  // Email is external HTTP — run it AFTER the response is sent so it never adds
  // latency to the click. (Vercel keeps the function alive.) The phone push is
  // handled by the notifications-INSERT trigger, not from here.
  after(async () => {
    await emailUser(args.userId, { subject: args.title, html: notifHtml(args.title, args.body, args.link) });
  });
}

/** Progress-linked payments: when a task crosses a payment milestone
 *  (25/50/75/90/100%), tell finance (org owners/admins — the finance role is
 *  folded into admin today) to anticipate a payment. Deduped via
 *  tasks.payment_milestone_notified so each milestone announces once. Best-effort;
 *  call it after any change that can move a task's progress. */
export async function notifyPaymentMilestone(supabase: SupabaseClient, taskId: string): Promise<void> {
  try {
    const { data: task } = await supabase
      .from('tasks')
      .select('org_id, project_id, title, awarded_cost_cents, payment_milestone_notified')
      .eq('id', taskId)
      .maybeSingle();
    if (!task) return;
    const t = task as {
      org_id: string; project_id: string; title: string;
      awarded_cost_cents: number | null; payment_milestone_notified: number | null;
    };
    if (!t.awarded_cost_cents || t.awarded_cost_cents <= 0) return;

    const { data: pct } = await supabase.rpc('task_progress_pct', { p_task_id: taskId });
    const progress = (pct as number | null) ?? 0;
    const milestone =
      progress >= 100 ? 100 : progress >= 90 ? 90 : progress >= 75 ? 75 : progress >= 50 ? 50 : progress >= 25 ? 25 : 0;
    if (milestone <= (t.payment_milestone_notified ?? 0)) return; // already announced

    const { data: entitlement } = await supabase.rpc('task_payment_entitlement_cents', { p_task_id: taskId });
    const usd = (((entitlement as number | null) ?? 0) / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });

    const { data: mgrs } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('org_id', t.org_id)
      .eq('status', 'active')
      .in('role', ['owner', 'admin']);

    await Promise.all(
      ((mgrs ?? []) as { user_id: string }[]).map((m) =>
        notifyUser(supabase, {
          orgId: t.org_id,
          userId: m.user_id,
          type: 'payment_anticipated',
          title: `Payment coming up — ${t.title} is ${milestone}% complete`,
          body: `About ${usd} becomes claimable (net of retention). Expect a payment request from the contractor.`,
          link: `/projects/${t.project_id}/finance`,
          entityId: taskId,
        }),
      ),
    );
    await supabase.from('tasks').update({ payment_milestone_notified: milestone }).eq('id', taskId);
  } catch {
    /* best-effort — never break the workflow that triggered it */
  }
}

/** Practical completion recorded: tell each contractor holding retention when it
 *  becomes releasable and how much. Best-effort — never breaks the completion. */
export async function notifyRetentionReleaseScheduled(supabase: SupabaseClient, projectId: string): Promise<void> {
  try {
    const { getProjectRetention } = await import('@/lib/data/retention');
    const { data: proj } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
    const p = proj as { org_id: string; name: string } | null;
    if (!p) return;
    const retention = await getProjectRetention(projectId);
    if (!retention) return;

    const when = retention.releaseAt
      ? new Date(retention.releaseAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : null;

    await Promise.all(
      retention.contractors
        .filter((c) => c.availableCents > 0)
        .map((c) => {
          const usd = (c.availableCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
          return notifyUser(supabase, {
            orgId: p.org_id,
            userId: c.contractorId,
            type: 'retention_release_scheduled',
            title: `Retention release scheduled — ${p.name}`,
            body: when
              ? `${p.name} reached practical completion. Your held retention (${usd}) becomes releasable on ${when}.`
              : `${p.name} reached practical completion. Your held retention (${usd}) is now releasable.`,
            link: '/payments',
            entityId: projectId,
          });
        }),
    );
  } catch {
    /* best-effort */
  }
}

/** Notify every project manager of a project (used on accept/decline). */
export async function notifyProjectManagers(
  supabase: SupabaseClient,
  args: { orgId: string; projectId: string; type: string; title: string; body?: string; link?: string; entityId?: string },
): Promise<void> {
  const { data } = await supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', args.projectId)
    .eq('role', 'pm');
  const pms = (data ?? []) as { user_id: string }[];
  await Promise.all(
    pms.map((pm) => notifyUser(supabase, { ...args, userId: pm.user_id })),
  );
}
