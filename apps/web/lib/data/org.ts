import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import type { OrgRole } from '@datumpro/shared/access';

/** Cookie that remembers which org the user last switched to. Read on the server
 *  to resolve the "active" org; falls back to the first membership. */
export const ACTIVE_ORG_COOKIE = 'dp_active_org';

export interface OrgMembershipSummary {
  orgId: string;
  name: string;
  role: OrgRole;
}

export interface ActiveContext {
  userId: string;
  email: string | null;
  memberships: OrgMembershipSummary[];
  active: OrgMembershipSummary | null;
}

type MembershipQueryRow = {
  role: string | null;
  org_id: string;
  organizations: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
};

function orgName(row: MembershipQueryRow): string {
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  return org?.name ?? 'Organisation';
}

/** Resolve the signed-in user, all their active org memberships, and which one is
 *  "active" (cookie preference, else the first). RLS already scopes the query. */
export async function getActiveContext(): Promise<ActiveContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('org_members')
    .select('role, org_id, organizations(id, name)')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const memberships: OrgMembershipSummary[] = ((data ?? []) as MembershipQueryRow[]).map((m) => ({
    orgId: m.org_id,
    name: orgName(m),
    role: (m.role ?? 'viewer') as OrgRole,
  }));

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.orgId === preferred) ?? memberships[0] ?? null;

  return { userId: user.id, email: user.email ?? null, memberships, active };
}

export interface SidebarProject {
  id: string;
  name: string;
}

export interface SidebarData {
  projects: SidebarProject[];
  myTaskCount: number;
}

/** Lightweight data for the sidebar: the active org's projects and the count of
 *  the user's open (not-done) assigned tasks. */
export async function getSidebarData(orgId: string, userId: string): Promise<SidebarData> {
  const supabase = await createClient();
  const [projectsRes, taskCountRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('assignee_id', userId)
      .neq('status', 'done'),
  ]);

  return {
    projects: (projectsRes.data ?? []) as SidebarProject[],
    myTaskCount: taskCountRes.count ?? 0,
  };
}
