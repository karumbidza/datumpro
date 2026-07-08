import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** List every organization with a member count — the org-access roster for
 *  Mission Control. Service-role: bypasses RLS, so it's guarded by the adapter
 *  secret only. */
export async function GET(req: Request) {
  if (!adapterAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createAdminClient();
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id,name,slug,created_at')
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: members } = await supabase.from('org_members').select('org_id,status');
  const counts = new Map<string, number>();
  for (const m of members ?? []) counts.set(m.org_id, (counts.get(m.org_id) ?? 0) + 1);

  return NextResponse.json({
    orgs: (orgs ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      plan: null, // billing not modeled yet
      memberCount: counts.get(o.id) ?? 0,
      status: 'active', // org-level suspend isn't modeled; access is per-member
      createdAt: o.created_at,
    })),
  });
}
