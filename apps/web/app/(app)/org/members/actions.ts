'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ORG_ROLES, type OrgRole } from '@datumpro/shared/access';
import { sendEmail } from '@/lib/email/resend';
import { inviteEmail, appUrl } from '@/lib/email/templates';

function parseRole(value: FormDataEntryValue | null): OrgRole {
  const role = String(value ?? '');
  if (!(ORG_ROLES as readonly string[]).includes(role)) throw new Error('Invalid organisation role');
  return role as OrgRole;
}

/** Invite someone to the active org by email. RLS (is_org_admin) rejects
 *  non-admins on insert. Emails an accept link (best-effort). */
export async function inviteMember(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = parseRole(formData.get('role'));
  if (!orgId || !email) throw new Error('Missing organisation or email');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const { error } = await supabase
    .from('org_invitations')
    .insert({ org_id: orgId, email, role, token, invited_by: user?.id ?? null });
  if (error) {
    if (error.code === '23505') throw new Error('There is already a pending invitation for that email.');
    throw new Error(error.message);
  }

  // Context for the email (RLS lets an org member read the org + profiles).
  const [{ data: org }, { data: inviter }] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', orgId).single(),
    user ? supabase.from('profiles').select('display_name, email').eq('id', user.id).single() : Promise.resolve({ data: null }),
  ]);
  const inviterName =
    (inviter as { display_name?: string; email?: string } | null)?.display_name ||
    (inviter as { email?: string } | null)?.email ||
    'A teammate';
  const { subject, html } = inviteEmail({
    orgName: (org as { name?: string } | null)?.name ?? 'DatumPro',
    inviterName,
    role,
    acceptUrl: `${appUrl()}/invite/${token}`,
  });
  await sendEmail({ to: email, subject, html });

  revalidatePath('/org/members');
}

/** Cancel a pending invitation. RLS (is_org_admin) enforces authority. */
export async function revokeInvitation(formData: FormData) {
  const invitationId = String(formData.get('invitationId') ?? '');
  if (!invitationId) throw new Error('Missing invitation');
  const supabase = await createClient();
  const { error } = await supabase
    .from('org_invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId);
  if (error) throw new Error(error.message);
  revalidatePath('/org/members');
}
