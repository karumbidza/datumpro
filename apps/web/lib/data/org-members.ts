import { createClient } from '@/lib/supabase/server';
import type { OrgRole } from '@datumpro/shared/access';

export interface OrgMemberRow {
  userId: string;
  name: string;
  email: string | null;
  role: OrgRole;
  status: 'active' | 'disabled';
}

export interface OrgInvitationRow {
  id: string;
  email: string;
  role: OrgRole;
  createdAt: string;
}

export interface InvitationPreview {
  orgName: string;
  email: string;
  role: OrgRole;
  status: 'pending' | 'accepted' | 'revoked';
}

/** Active + disabled members of an org, with display name/email. RLS scopes to
 *  the org. Active first, then disabled (so they can be reactivated). */
export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('user_id, role, status, profiles(display_name, email)')
    .eq('org_id', orgId)
    .in('status', ['active', 'disabled']);
  const rows = ((data ?? []) as {
    user_id: string;
    role: string;
    status: string;
    profiles:
      | { display_name: string | null; email: string | null }
      | { display_name: string | null; email: string | null }[]
      | null;
  }[]).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return {
      userId: m.user_id,
      name: p?.display_name || p?.email || 'Member',
      email: p?.email ?? null,
      role: (m.role ?? 'member') as OrgRole,
      status: (m.status === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled',
    };
  });
  // Active first, then disabled.
  return rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
}

/** Pending invitations for an org (admins only — RLS enforces). */
export async function listPendingInvitations(orgId: string): Promise<OrgInvitationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_invitations')
    .select('id, email, role, created_at')
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return ((data ?? []) as { id: string; email: string; role: string; created_at: string }[]).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role as OrgRole,
    createdAt: i.created_at,
  }));
}

/** Preview an invitation by token for the accept screen (RLS-independent RPC). */
export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('invitation_preview', { p_token: token });
  const row = ((data ?? []) as { org_name: string; email: string; role: string; status: string }[])[0];
  if (!row) return null;
  return {
    orgName: row.org_name,
    email: row.email,
    role: row.role as OrgRole,
    status: row.status as InvitationPreview['status'],
  };
}
