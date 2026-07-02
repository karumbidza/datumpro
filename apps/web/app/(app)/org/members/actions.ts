'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ORG_ROLES, PROJECT_ROLES, type OrgRole, type ProjectRole } from '@datumpro/shared/access';
import { sendEmail } from '@/lib/email/resend';
import { inviteEmail, appUrl } from '@/lib/email/templates';

function parseRole(value: FormDataEntryValue | null): OrgRole {
  const role = String(value ?? '');
  if (!(ORG_ROLES as readonly string[]).includes(role)) throw new Error('Invalid organisation role');
  return role as OrgRole;
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

/** Change a member's organisation role. RLS restricts to owner/admin; we also
 *  block changing your own role and handing out 'owner' (transfer is separate). */
export async function updateOrgMemberRole(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const role = parseRole(formData.get('role'));
  if (role === 'owner') throw new Error('Ownership is transferred separately, not assigned.');
  const { supabase, user } = await requireUser();
  if (userId === user.id) throw new Error('You cannot change your own role.');
  const { error } = await supabase
    .from('org_members')
    .update({ role })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  revalidatePath('/org/members');
}

/** Remove a member from the organisation (owner/admin). Can't remove yourself. */
export async function removeOrgMember(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const { supabase, user } = await requireUser();
  if (userId === user.id) throw new Error('You cannot remove yourself.');
  const { error } = await supabase
    .from('org_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  revalidatePath('/org/members');
}

/** Assign an existing org member to a project with a project role. RLS
 *  (can_manage_project) rejects anyone who isn't an org admin or the project PM. */
export async function assignMemberToProject(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const roleStr = String(formData.get('projectRole') ?? '');
  if (!projectId || !userId) throw new Error('Pick a project and member.');
  if (!(PROJECT_ROLES as readonly string[]).includes(roleStr)) throw new Error('Invalid project role');
  const role = roleStr as ProjectRole;

  const { supabase } = await requireUser();
  const { data: project } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  if (!project) throw new Error('Project not found');
  const { error } = await supabase
    .from('project_members')
    .upsert(
      { org_id: (project as { org_id: string }).org_id, project_id: projectId, user_id: userId, role },
      { onConflict: 'project_id,user_id' },
    );
  if (error) throw new Error(error.message);
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
