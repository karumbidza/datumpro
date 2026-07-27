import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** List enterprise/government access requests for manual review. Service-role:
 *  bypasses RLS, guarded by the adapter secret only. */
export async function GET(req: Request) {
  if (!adapterAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('enterprise_requests')
    .select('id, org_name, buyer_type, country, contact_name, contact_email, team_size, needs, status, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data ?? [] });
}
