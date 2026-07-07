'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ORG_ROLES, PROJECT_ROLES, type OrgRole, type ProjectRole } from '@datumpro/shared/access';
import { sendEmail } from '@/lib/email/resend';
import { inviteEmail, appUrl } from '@/lib/email/templates';

const MEMBERS = '/org/members';

/** Redirect back to the Members page with an inline error banner. Server-action
 *  throws surface as a full-page error boundary, so every expected failure goes
 *  through here instead — the page shows the message and stays usable. */
function fail(message: string): never {
  redirect(`${MEMBERS}?error=${encodeURIComponent(message)}`);
}

/** Redirect back on success (revalidate + clean/flagged URL clears stale errors). */
function done(flag?: string): never {
  revalidatePath(MEMBERS);
  redirect(flag ? `${MEMBERS}?${flag}=1` : MEMBERS);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

/** Invite someone to the active org by email. RLS (is_org_admin) rejects
 *  non-admins on insert. Emails an accept link (best-effort). */
export async function inviteMember(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleRaw = String(formData.get('role') ?? '');
  if (!(ORG_ROLES as readonly string[]).includes(roleRaw)) fail('Invalid organisation role.');
  if (!orgId || !email) fail('Enter an email address.');
  const role = roleRaw as OrgRole;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    const { error } = await supabase
      .from('org_invitations')
      .insert({ org_id: orgId, email, role, token, invited_by: user?.id ?? null });
    if (error) {
      if (error.code === '23505') fail('There is already a pending invitation for that email.');
      fail(error.message);
    }

    // Best-effort email — never let a mail hiccup fail the invite.
    try {
      const [{ data: org }, { data: inviter }] = await Promise.all([
        supabase.from('organizations').select('name').eq('id', orgId).single(),
        user
          ? supabase.from('profiles').select('display_name, email').eq('id', user.id).single()
          : Promise.resolve({ data: null }),
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
    } catch (mailErr) {
      console.error('[invite] email failed (invitation still created):', mailErr);
    }
  } catch (e) {
    // NEXT_REDIRECT from fail() must propagate; only real errors are caught here.
    if (isRedirect(e)) throw e;
    fail(e instanceof Error ? e.message : 'Could not send the invitation.');
  }

  done('invited');
}

/** Change a member's organisation role. RLS restricts to owner/admin; we also
 *  block changing your own role and handing out 'owner' (transfer is separate). */
export async function updateOrgMemberRole(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const roleRaw = String(formData.get('role') ?? '');
  const { supabase, user } = await requireUser();

  if (!(ORG_ROLES as readonly string[]).includes(roleRaw)) fail('Invalid organisation role.');
  if (roleRaw === 'owner') fail('Ownership is transferred separately, not assigned.');
  if (userId === user.id) fail('You cannot change your own role.');

  const { error } = await supabase
    .from('org_members')
    .update({ role: roleRaw as OrgRole })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) fail(error.message);
  done();
}

/** Remove a member from the organisation (owner/admin). Can't remove yourself. */
export async function removeOrgMember(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const { supabase, user } = await requireUser();
  if (userId === user.id) fail('You cannot remove yourself.');

  const { error } = await supabase
    .from('org_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) fail(error.message);
  done();
}

/** Soft off-boarding: set a member's status to 'disabled'. Owner/admin only. */
export async function deactivateOrgMember(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const { supabase, user } = await requireUser();
  if (userId === user.id) fail('You cannot deactivate yourself.');

  const { data: target } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if ((target as { role?: string } | null)?.role === 'owner') {
    fail('The owner cannot be deactivated.');
  }

  const { error } = await supabase
    .from('org_members')
    .update({ status: 'disabled' })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) fail(error.message);
  done();
}

/** Restore a disabled member to 'active' at their existing role. Owner/admin only. */
export async function reactivateOrgMember(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('org_members')
    .update({ status: 'active' })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) fail(error.message);
  done();
}

/** Assign an existing org member to a project with a project role. RLS
 *  (can_manage_project) rejects anyone who isn't an org admin or the project PM. */
export async function assignMemberToProject(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const roleStr = String(formData.get('projectRole') ?? '');
  if (!projectId || !userId) fail('Pick a project and a member.');
  if (!(PROJECT_ROLES as readonly string[]).includes(roleStr)) fail('Invalid project role.');
  const role = roleStr as ProjectRole;

  const { supabase } = await requireUser();
  const { data: project } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  if (!project) fail('Project not found.');
  const { error } = await supabase.from('project_members').upsert(
    { org_id: (project as { org_id: string }).org_id, project_id: projectId, user_id: userId, role },
    { onConflict: 'project_id,user_id' },
  );
  if (error) fail(error.message);
  done('assigned');
}

/** Cancel a pending invitation. RLS (is_org_admin) enforces authority. */
export async function revokeInvitation(formData: FormData) {
  const invitationId = String(formData.get('invitationId') ?? '');
  if (!invitationId) fail('Missing invitation.');
  const supabase = await createClient();
  const { error } = await supabase
    .from('org_invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId);
  if (error) fail(error.message);
  done();
}

/** Re-send the invite email for an existing pending invitation, reusing its
 *  token. Admin-only (RLS). Email is best-effort. */
export async function resendInvitation(formData: FormData) {
  const invitationId = String(formData.get('invitationId') ?? '');
  if (!invitationId) fail('Missing invitation.');
  const supabase = await createClient();

  const { data, error: readErr } = await supabase
    .from('org_invitations')
    .select('org_id, email, role, token, status')
    .eq('id', invitationId)
    .maybeSingle();
  if (readErr) fail(readErr.message);
  const inv = data as
    | { org_id: string; email: string; role: string; token: string; status: string }
    | null;
  if (!inv || inv.status !== 'pending') fail('No pending invitation to resend.');

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const [{ data: org }, { data: inviter }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', inv.org_id).single(),
      user
        ? supabase.from('profiles').select('display_name, email').eq('id', user.id).single()
        : Promise.resolve({ data: null }),
    ]);
    const inviterName =
      (inviter as { display_name?: string; email?: string } | null)?.display_name ||
      (inviter as { email?: string } | null)?.email ||
      'A teammate';
    const { subject, html } = inviteEmail({
      orgName: (org as { name?: string } | null)?.name ?? 'DatumPro',
      inviterName,
      role: inv.role as OrgRole,
      acceptUrl: `${appUrl()}/invite/${inv.token}`,
    });
    await sendEmail({ to: inv.email, subject, html });
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('[invite] resend email failed:', e);
  }

  done('resent');
}

/** Next's redirect() signals control flow by throwing a special error; it must
 *  never be swallowed by a catch meant for real failures. */
function isRedirect(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');
}
