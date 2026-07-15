import { createClient } from '@/lib/supabase/server';
import { listProjectMembers } from '@/lib/data/members';
import type { ProjectRole, MemberType } from '@datumpro/shared/access';

/** One person in a chat's People rail: identity + contact + on-project task stats.
 *  Recent activity is loaded lazily on detail open (see getMemberActivity). */
export interface RosterMember {
  userId: string;
  name: string;
  role: ProjectRole;
  memberType: MemberType;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  lastActiveAt: string | null;
  openTasks: number;
  doneTasks: number;
}

interface ProfileBits {
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  lastActiveAt: string | null;
}

/** Enrich a project's members with contact details + per-project task counts,
 *  ready for the chat People rail. RLS scopes both the member list and profiles
 *  to what the caller may see. */
export async function listChatRoster(
  projectId: string,
  userIds?: string[],
): Promise<RosterMember[]> {
  const members = await listProjectMembers(projectId);
  const roster = userIds ? members.filter((m) => userIds.includes(m.userId)) : members;
  if (roster.length === 0) return [];

  const ids = roster.map((m) => m.userId);
  const supabase = await createClient();

  const [{ data: profileRows }, { data: taskRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, phone, avatar_url, last_active_at')
      .in('id', ids),
    supabase
      .from('tasks')
      .select('assignee_id, status')
      .eq('project_id', projectId)
      .in('assignee_id', ids),
  ]);

  const profiles = new Map<string, ProfileBits>(
    ((profileRows ?? []) as {
      id: string;
      email: string | null;
      phone: string | null;
      avatar_url: string | null;
      last_active_at: string | null;
    }[]).map((p) => [
      p.id,
      { email: p.email, phone: p.phone, avatarUrl: p.avatar_url, lastActiveAt: p.last_active_at },
    ]),
  );

  const counts = new Map<string, { open: number; done: number }>();
  for (const t of (taskRows ?? []) as { assignee_id: string | null; status: string }[]) {
    if (!t.assignee_id) continue;
    const c = counts.get(t.assignee_id) ?? { open: 0, done: 0 };
    if (t.status === 'done') c.done += 1;
    else c.open += 1;
    counts.set(t.assignee_id, c);
  }

  return roster.map((m) => {
    const p = profiles.get(m.userId);
    const c = counts.get(m.userId);
    return {
      userId: m.userId,
      name: m.name,
      role: m.role,
      memberType: m.memberType,
      email: p?.email ?? m.email,
      phone: p?.phone ?? null,
      avatarUrl: p?.avatarUrl ?? null,
      lastActiveAt: p?.lastActiveAt ?? null,
      openTasks: c?.open ?? 0,
      doneTasks: c?.done ?? 0,
    };
  });
}

export interface ActivityItem {
  id: string;
  text: string;
  at: string;
}

/** A member's recent consequential actions on this project — sourced from the
 *  audit log (same feed the Activity tab reads), scoped to the project's tasks
 *  and the project row itself. Loaded lazily when the rail detail view opens. */
export async function listMemberActivity(
  projectId: string,
  userId: string,
): Promise<ActivityItem[]> {
  const supabase = await createClient();

  const { data: projectRow } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .maybeSingle();
  const orgId = (projectRow as { org_id: string } | null)?.org_id;
  if (!orgId) return [];

  const { data: taskRows } = await supabase
    .from('tasks')
    .select('id')
    .eq('project_id', projectId);
  const entityIds = [
    ...((taskRows ?? []) as { id: string }[]).map((t) => t.id),
    projectId,
  ];

  const { data } = await supabase
    .from('audit_logs')
    .select('id, action, entity_type, created_at')
    .eq('org_id', orgId)
    .eq('actor_id', userId)
    .in('entity_id', entityIds)
    .order('created_at', { ascending: false })
    .limit(8);

  return ((data ?? []) as {
    id: string;
    action: string;
    entity_type: string;
    created_at: string;
  }[]).map((r) => ({
    id: r.id,
    text: humanizeAudit(r.entity_type, r.action),
    at: r.created_at,
  }));
}

/** "task" + "status.submitted" → "Submitted a task". Best-effort, human-readable. */
function humanizeAudit(entityType: string, action: string): string {
  const verb = action.split('.').pop()?.replace(/_/g, ' ') ?? action;
  const noun = entityType.replace(/_/g, ' ');
  const cap = verb.charAt(0).toUpperCase() + verb.slice(1);
  return `${cap} · ${noun}`;
}
