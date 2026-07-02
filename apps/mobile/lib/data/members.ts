import { supabase } from '../supabase';

export interface Member {
  userId: string;
  name: string;
}

/** Members of a project (for the assignee picker). RLS scopes to the project. */
export async function listProjectMembers(projectId: string): Promise<Member[]> {
  const { data } = await supabase
    .from('project_members')
    .select('user_id, profiles(display_name, email)')
    .eq('project_id', projectId);
  return ((data ?? []) as {
    user_id: string;
    profiles: { display_name: string | null; email: string | null } | { display_name: string | null; email: string | null }[] | null;
  }[]).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { userId: m.user_id, name: p?.display_name || p?.email || 'Member' };
  });
}
