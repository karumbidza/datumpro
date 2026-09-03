import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Public route for prospective customers to request access & custom quotes.
 * Saves entries to `enterprise_requests` table for review in Pulse.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    orgName?: string;
    contactName?: string;
    contactEmail?: string;
    phone?: string;
    teamSize?: string;
    needs?: string;
    planTier?: string;
  };

  if (!body.orgName?.trim() || !body.contactName?.trim() || !body.contactEmail?.trim()) {
    return NextResponse.json(
      { error: 'Organization name, contact name, and email are required.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('enterprise_requests')
      .insert({
        org_name: body.orgName.trim(),
        contact_name: body.contactName.trim(),
        contact_email: body.contactEmail.trim().toLowerCase(),
        country: body.phone ?? null,
        team_size: body.teamSize ?? '1-10',
        needs: body.needs ? `Plan: ${body.planTier ?? 'Standard'} | Notes: ${body.needs}` : `Plan: ${body.planTier ?? 'Standard'}`,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save access request';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
