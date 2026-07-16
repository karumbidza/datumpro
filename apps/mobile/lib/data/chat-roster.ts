import { supabase } from '../supabase';

/** One person in a chat's roster — identity + contact + presence source. */
export interface RosterMember {
  userId: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  lastActiveAt: string | null;
}

/** The people in a conversation, for the chat's member list. Derived from the
 *  conversation's project: project chats show every member; task DMs show the
 *  PM(s) + the bound contractor. RLS scopes what the caller can read. */
export async function getConversationRoster(conversationId: string): Promise<RosterMember[]> {
  const { data: conv } = await supabase
    .from('conversations')
    .select('project_id, type, contractor_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return [];
  const c = conv as { project_id: string; type: string; contractor_id: string | null };

  const { data: pm } = await supabase
    .from('project_members')
    .select('user_id, role')
    .eq('project_id', c.project_id);
  let rows = (pm ?? []) as { user_id: string; role: string }[];
  if (c.type === 'task_dm') {
    rows = rows.filter((r) => r.role === 'pm' || r.user_id === c.contractor_id);
  }
  const ids = rows.map((r) => r.user_id);
  if (ids.length === 0) return [];

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, display_name, email, phone, last_active_at')
    .in('id', ids);
  const pmap = new Map(
    ((profs ?? []) as {
      id: string;
      display_name: string | null;
      email: string | null;
      phone: string | null;
      last_active_at: string | null;
    }[]).map((p) => [p.id, p]),
  );

  return rows.map((r) => {
    const p = pmap.get(r.user_id);
    return {
      userId: r.user_id,
      name: p?.display_name || p?.email || 'Member',
      role: r.role,
      email: p?.email ?? null,
      phone: p?.phone ?? null,
      lastActiveAt: p?.last_active_at ?? null,
    };
  });
}
