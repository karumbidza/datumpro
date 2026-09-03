import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';

export const dynamic = 'force-dynamic';

/**
 * Admin adapter route: generate a direct onboarding invitation for a prospective client.
 * Guarded by adapter secret only.
 */
export async function POST(req: Request) {
  if (!adapterAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    orgName?: string;
    contactEmail?: string;
    contactName?: string;
    planTier?: string;
    requestId?: string;
  };

  if (!body.orgName?.trim() || !body.contactEmail?.trim()) {
    return NextResponse.json(
      { error: 'orgName and contactEmail are required' },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();

    // Generate random 16-char hex token
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days

    // Store in enterprise_requests or active invitations
    if (body.requestId) {
      await supabase
        .from('enterprise_requests')
        .update({ status: 'invite_sent' })
        .eq('id', body.requestId);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.datumpro.app';
    const inviteUrl = `${appUrl}/invite/${token}?org=${encodeURIComponent(body.orgName)}&email=${encodeURIComponent(body.contactEmail)}&plan=${encodeURIComponent(body.planTier ?? 'Standard')}`;

    // Send transactional invitation email via Resend
    await sendEmail({
      to: body.contactEmail,
      subject: `Your ${body.orgName} Workspace Invitation on DatumPro`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
          <h2 style="color: #4f46e5;">Welcome to DatumPro</h2>
          <p>Hello ${body.contactName || 'there'},</p>
          <p>Your access request for <strong>${body.orgName}</strong> has been approved under the <strong>${body.planTier || 'Standard'}</strong> plan.</p>
          <p>Please click the button below to set up your password and access your workspace:</p>
          <p style="margin: 24px 0;">
            <a href="${inviteUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; inline-block;">Activate Your Workspace</a>
          </p>
          <p style="font-size: 12px; color: #64748b;">Or copy and paste this URL into your browser: <br/><code>${inviteUrl}</code></p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;"/>
          <p style="font-size: 11px; color: #94a3b8;">DatumPro Onboarding Team &middot; ${appUrl}</p>
        </div>
      `,
    });

    return NextResponse.json({
      ok: true,
      token,
      inviteUrl,
      expiresAt,
      orgName: body.orgName,
      contactEmail: body.contactEmail,
      planTier: body.planTier ?? 'Standard',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create invitation';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
