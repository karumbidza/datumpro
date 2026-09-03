'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/resend';
import { demoRequestEmail } from '@/lib/email/templates';

/** Public "Request a demo" form on the landing page. Onboarding is
 *  admin-managed — there is no self-serve signup — so the form records an
 *  intent and a specialist follows up.
 *
 *  The insert reuses the same SECURITY DEFINER RPC as /enterprise (the only
 *  write the anon role may make to enterprise_requests); the notification email
 *  is best-effort and never blocks the submitter. On success we return to the
 *  landing page's #demo section with a confirmation banner. */
export async function requestDemo(formData: FormData) {
  const orgName = String(formData.get('orgName') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const teamSize = String(formData.get('teamSize') ?? '').trim();
  const needs = String(formData.get('needs') ?? '').trim();

  // Honeypot: a hidden field no human sees. If it's filled, the submitter is a
  // bot — pretend success and drop it silently so the bot gets no signal to
  // adapt. Real submissions leave it empty.
  if (String(formData.get('website') ?? '').trim() !== '') {
    redirect('/?demo=sent#demo');
  }

  if (!orgName || !contactEmail || !contactEmail.includes('@')) {
    redirect('/?demo=error#demo');
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_enterprise_request', {
    p_org_name: orgName,
    p_buyer_type: 'demo',
    p_country: '',
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_team_size: teamSize,
    p_needs: needs,
  });
  if (error) {
    redirect('/?demo=error#demo');
  }

  // Best-effort internal notification — never block the submitter on mail.
  try {
    const to = process.env.ENTERPRISE_REQUEST_NOTIFY_EMAIL;
    if (to) {
      const { subject, html } = demoRequestEmail({ orgName, contactName, contactEmail, teamSize, needs });
      await sendEmail({ to, subject, html, replyTo: contactEmail });
    } else {
      console.info('[demo] ENTERPRISE_REQUEST_NOTIFY_EMAIL unset — request recorded, notification skipped.');
    }
  } catch (e) {
    console.error('[demo] notification email failed (request still recorded):', e);
  }

  redirect('/?demo=sent#demo');
}
