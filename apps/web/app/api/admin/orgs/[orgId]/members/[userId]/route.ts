import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Org roles Pulse may assign, and the member_type each maps to (mirrors the DB's
// type_for_org_role). 'owner' is intentionally excluded — ownership transfer is a
// heavier operation than a role edit and isn't exposed through the control plane.
const ROLE_TO_TYPE: Record<string, string> = {
  admin: 'admin',
  finance: 'finance',
  pm: 'pm',
  member: 'staff',
  viewer: 'viewer',
};

/** Enable or disable a member's access from Mission Control. Disabling sets the
 *  member's status to 'disabled' (RLS helpers only count 'active' members, so the
 *  person loses all org access immediately); enabling restores 'active'. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  if (!adapterAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { orgId, userId } = await params;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'disable' && body.action !== 'enable') {
    return NextResponse.json({ error: 'action must be "disable" or "enable"' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: target } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();
  if (!target) return NextResponse.json({ error: 'member not found' }, { status: 404 });

  // Never lock the org out of itself: the owner can't be disabled from here.
  if (body.action === 'disable' && target.role === 'owner') {
    return NextResponse.json({ error: 'cannot disable the org owner' }, { status: 400 });
  }

  const status = body.action === 'disable' ? 'disabled' : 'active';
  const { error } = await supabase
    .from('org_members')
    .update({ status })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/** Change a member's org role. Keeps member_type in sync (so downstream project-
 *  role constraints stay consistent) and refuses to touch the owner. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  if (!adapterAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { orgId, userId } = await params;

  const body = (await req.json().catch(() => ({}))) as { role?: string };
  const role = body.role ?? '';
  const memberType = ROLE_TO_TYPE[role];
  if (!memberType) {
    return NextResponse.json(
      { error: `role must be one of ${Object.keys(ROLE_TO_TYPE).join(', ')}` },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: target } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();
  if (!target) return NextResponse.json({ error: 'member not found' }, { status: 404 });
  if (target.role === 'owner') {
    return NextResponse.json({ error: "the owner's role can't be changed here" }, { status: 400 });
  }

  const { error } = await supabase
    .from('org_members')
    .update({ role, member_type: memberType })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
