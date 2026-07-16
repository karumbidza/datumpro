import { supabase } from '../supabase';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(limit = 40): Promise<AppNotification[]> {
  const { data } = await supabase
    .from('notifications')
    .select('id, type, title, body, entity_type, entity_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as {
    id: string;
    type: string;
    title: string;
    body: string | null;
    entity_type: string | null;
    entity_id: string | null;
    read_at: string | null;
    created_at: string;
  }[]).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    entityType: n.entity_type,
    entityId: n.entity_id,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

export async function unreadNotificationCount(): Promise<number> {
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  return count ?? 0;
}

export async function markAllNotificationsRead(): Promise<void> {
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
}
