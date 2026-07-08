import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Support bridge — the in-app chat widget (tenant admins) talks to THIS route,
 * which forwards to Pulse. The Pulse adapter secret never reaches the browser.
 * Only org admins may open a support thread for their org.
 */

const PULSE_URL = process.env.PULSE_URL;
const SECRET = process.env.ADMIN_ADAPTER_SECRET;

async function authorize(orgId: string) {
  if (!PULSE_URL || !SECRET) {
    return { error: NextResponse.json({ error: 'support not configured' }, { status: 503 }) };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single();
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(req: Request) {
  const orgId = new URL(req.url).searchParams.get('orgId') ?? '';
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });
  const auth = await authorize(orgId);
  if (auth.error) return auth.error;

  const res = await fetch(
    `${PULSE_URL}/api/support/messages?orgId=${encodeURIComponent(orgId)}&requesterUserId=${encodeURIComponent(auth.user.id)}`,
    { headers: { authorization: `Bearer ${SECRET}` }, cache: 'no-store' },
  );
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { orgId?: string; body?: string };
  if (!body.orgId || !body.body?.trim()) {
    return NextResponse.json({ error: 'orgId and body required' }, { status: 400 });
  }
  const auth = await authorize(body.orgId);
  if (auth.error) return auth.error;

  const res = await fetch(`${PULSE_URL}/api/support/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      orgId: body.orgId,
      requesterUserId: auth.user.id,
      requesterLabel: auth.user.email,
      body: body.body,
    }),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
