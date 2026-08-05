'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/resend';
import { enterpriseRequestEmail } from '@/lib/email/templates';

/** Public, unauthenticated request from /enterprise. The insert goes through a
 *  SECURITY DEFINER RPC (the only write the anon role may make to
 *  enterprise_requests); the notification email is best-effort. */
export async function submitEnterpriseRequest(formData: FormData) {
  const orgName = String(formData.get('orgName') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim();
  const buyerType = String(formData.get('buyerType') ?? '').trim();
  const country = String(formData.get('country') ?? '').trim();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const teamSize = String(formData.get('teamSize') ?? '').trim();
  const needs = String(formData.get('needs') ?? '').trim();

  // Honeypot (assessment F6): a hidden field no human sees. If it's filled, the
  // submitter is a bot — pretend success and drop it silently so the bot gets no
  // signal to adapt. Real submissions leave it empty.
  if (String(formData.get('website') ?? '').trim() !== '') {
    redirect('/enterprise?sent=1');
  }

  if (!orgName || !contactEmail || !contactEmail.includes('@')) {
    redirect('/enterprise?error=' + encodeURIComponent('Please enter your organisation and a valid email.'));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_enterprise_request', {
    p_org_name: orgName,
    p_buyer_type: buyerType,
    p_country: country,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_team_size: teamSize,
    p_needs: needs,
  });
  if (error) {
    redirect('/enterprise?error=' + encodeURIComponent(error.message));
  }

  // Best-effort internal notification — never block the submitter on mail.
  try {
    const to = process.env.ENTERPRISE_REQUEST_NOTIFY_EMAIL;
    if (to) {
      const { subject, html } = enterpriseRequestEmail({
        orgName,
        buyerType,
        country,
        contactName,
        contactEmail,
        teamSize,
        needs,
      });
      await sendEmail({ to, subject, html, replyTo: contactEmail });
    } else {
      console.info('[enterprise] ENTERPRISE_REQUEST_NOTIFY_EMAIL unset — request recorded, notification skipped.');
    }
  } catch (e) {
    console.error('[enterprise] notification email failed (request still recorded):', e);
  }

  redirect('/enterprise?sent=1');
}
