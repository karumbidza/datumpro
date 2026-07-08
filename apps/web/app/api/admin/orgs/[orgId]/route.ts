import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** One org's full access picture: members (with profile identity) + pending
 *  invitations. */
export async function GET(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  if (!adapterAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { orgId } = await params;

  const supabase = createAdminClient();

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id,name,slug,created_at')
    .eq('id', orgId)
    .single();
  if (orgErr || !org) return NextResponse.json({ error: 'org not found' }, { status: 404 });

  const { data: members } = await supabase
    .from('org_members')
    .select('user_id,role,member_type,status,created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  const userIds = (members ?? []).map((m) => m.user_id);
  const profiles = userIds.length
    ? (await supabase.from('profiles').select('id,email,display_name').in('id', userIds)).data ?? []
    : [];
  const pmap = new Map(profiles.map((p) => [p.id, p]));

  const { data: invites } = await supabase
    .from('org_invitations')
    .select('id,email,role,status,created_at,accepted_at')
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return NextResponse.json({
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: null,
      memberCount: members?.length ?? 0,
      status: 'active',
      createdAt: org.created_at,
    },
    members: (members ?? []).map((m) => ({
      userId: m.user_id,
      email: pmap.get(m.user_id)?.email ?? null,
      name: pmap.get(m.user_id)?.display_name ?? null,
      role: m.role,
      memberType: m.member_type,
      status: m.status,
      joinedAt: m.created_at,
    })),
    invitations: (invites ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.created_at,
      expiresAt: null,
      acceptedAt: i.accepted_at,
    })),
  });
}
