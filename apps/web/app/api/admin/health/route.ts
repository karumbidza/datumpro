import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Adapter health probe for Mission Control: reports service + DB reachability. */
export async function GET(req: Request) {
  if (!adapterAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let db = false;
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('organizations').select('id', { count: 'exact', head: true });
    db = !error;
  } catch {
    db = false;
  }

  return NextResponse.json({
    ok: true,
    service: 'datumpro-web',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    time: new Date().toISOString(),
    db,
  });
}
