import { createClient } from '@/lib/supabase/server';

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

/** Emit an in-app notification to one user (guarded by the notify() SQL helper).
 *  Best-effort — never let a notification failure break the main action. */
export async function notifyUser(
  supabase: SupabaseClient,
  args: { orgId: string; userId: string; type: string; title: string; body?: string; link?: string; entityId?: string },
): Promise<void> {
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
    /* swallow — notifications must not block the workflow */
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
