import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Cross-org people search for Pulse: find a person by email or name and see every
 * org they belong to (with role + status). Powers "this user can't get in — where
 * are they and what access do they have?" from one box.
 *
 * GET /api/admin/members?q=<text>&limit=<n>
 */
export async function GET(req: Request) {
  if (!adapterAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 50);
  if (q.length < 2) return NextResponse.json({ people: [] });

  const supabase = createAdminClient();

  // Match people by email or display name.
  const pattern = `%${q}%`;
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id,email,display_name')
    .or(`email.ilike.${pattern},display_name.ilike.${pattern}`)
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (profiles ?? []).map((p) => p.id);
  if (ids.length === 0) return NextResponse.json({ people: [] });

  // All memberships for the matched people, with org names.
  const { data: memberships } = await supabase
    .from('org_members')
    .select('user_id,role,member_type,status,org_id,organizations(id,name)')
    .in('user_id', ids);

  type Membership = {
    user_id: string;
    role: string;
    member_type: string | null;
    status: string;
    org_id: string;
    organizations: { id: string; name: string } | { id: string; name: string }[] | null;
  };

  const byUser = new Map<string, Membership[]>();
  for (const m of (memberships ?? []) as Membership[]) {
    const list = byUser.get(m.user_id) ?? [];
    list.push(m);
    byUser.set(m.user_id, list);
  }

  const people = (profiles ?? []).map((p) => ({
    userId: p.id,
    email: p.email,
    name: p.display_name,
    orgs: (byUser.get(p.id) ?? []).map((m) => {
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      return {
        orgId: m.org_id,
        orgName: org?.name ?? 'Unknown',
        role: m.role,
        memberType: m.member_type,
        status: m.status,
      };
    }),
  }));

  return NextResponse.json({ people });
}
