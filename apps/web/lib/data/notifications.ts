import { createClient } from '@/lib/supabase/server';
import { emailUser } from '@/lib/email/notify';
import { sendExpoPushToUsers } from '@/lib/notify/push';
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
 *  and mobile push. Best-effort — never lets a delivery failure break the
 *  workflow that triggered it. */
export async function notifyUser(
  supabase: SupabaseClient,
  args: { orgId: string; userId: string; type: string; title: string; body?: string; link?: string; entityId?: string },
): Promise<void> {
  // In-app (guarded SQL helper).
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
  // Email + mobile push (each best-effort internally).
  await emailUser(args.userId, { subject: args.title, html: notifHtml(args.title, args.body, args.link) });
  await sendExpoPushToUsers([args.userId], { title: args.title, body: args.body ?? '', url: args.link });
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
