import { createClient } from '@/lib/supabase/server';
import type { ProjectRole } from '@datumpro/shared/access';

export interface ProjectMemberRow {
  userId: string;
  role: ProjectRole;
  name: string;
  email: string | null;
}

export interface AddableMember {
  userId: string;
  name: string;
  email: string | null;
  orgRole: string;
}

async function profileNames(
  ids: string[],
): Promise<Map<string, { name: string; email: string | null }>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, email')
    .in('id', ids);
  return new Map(
    ((data ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      { name: p.display_name || p.email || 'Member', email: p.email },
    ]),
  );
}

/** Members of a project with display names. RLS: visible to project members and
 *  company staff. */
export async function listProjectMembers(projectId: string): Promise<ProjectMemberRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_members')
    .select('user_id, role')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as { user_id: string; role: ProjectRole }[];
  const names = await profileNames(rows.map((r) => r.user_id));
  return rows.map((r) => ({
    userId: r.user_id,
    role: r.role,
    name: names.get(r.user_id)?.name ?? 'Member',
    email: names.get(r.user_id)?.email ?? null,
  }));
}

/** Company members who are NOT yet on this project — the pool you can add from.
 *  (Inviting brand-new people by email is a separate onboarding flow.) */
export async function listAddableOrgMembers(
  orgId: string,
  projectId: string,
): Promise<AddableMember[]> {
  const supabase = await createClient();
  const [orgRes, projRes] = await Promise.all([
    supabase.from('org_members').select('user_id, role').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('project_members').select('user_id').eq('project_id', projectId),
  ]);
  const onProject = new Set(
    ((projRes.data ?? []) as { user_id: string }[]).map((p) => p.user_id),
  );
  const candidates = ((orgRes.data ?? []) as { user_id: string; role: string }[]).filter(
    (m) => !onProject.has(m.user_id),
  );
  const names = await profileNames(candidates.map((c) => c.user_id));
  return candidates.map((c) => ({
    userId: c.user_id,
    name: names.get(c.user_id)?.name ?? 'Member',
    email: names.get(c.user_id)?.email ?? null,
    orgRole: c.role,
  }));
}

/** The caller's role on a project (null if not a member). The DB enforces the
 *  real rules; this only decides which controls to show. */
export async function myProjectRole(projectId: string): Promise<ProjectRole | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  return (data as { role: ProjectRole } | null)?.role ?? null;
}
