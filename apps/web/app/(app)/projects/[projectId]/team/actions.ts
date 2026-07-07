'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import {
  PROJECT_ROLES, projectRolesForType, MEMBER_TYPE_META,
  type ProjectRole, type MemberType,
} from '@datumpro/shared/access';

const teamPath = (projectId: string) => `/projects/${projectId}/team`;

/** Server-action throws surface as a full-page error boundary, so expected
 *  failures redirect back to the team page with an inline banner instead. */
function fail(projectId: string, message: string): never {
  redirect(`${teamPath(projectId)}?error=${encodeURIComponent(message)}`);
}
function done(projectId: string, flag?: string): never {
  revalidatePath(teamPath(projectId));
  redirect(flag ? `${teamPath(projectId)}?${flag}=1` : teamPath(projectId));
}

function validRole(projectId: string, raw: string): ProjectRole {
  if (!(PROJECT_ROLES as readonly string[]).includes(raw)) fail(projectId, 'Invalid project role.');
  return raw as ProjectRole;
}

async function memberTypeOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  userId: string,
): Promise<MemberType | null> {
  const { data } = await supabase
    .from('org_members')
    .select('member_type')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { member_type?: MemberType } | null)?.member_type ?? null;
}

/** Friendlier message for the two rejections the DB enforces. */
function explain(role: ProjectRole, message: string): string {
  if (role === 'pm' && /row-level security/i.test(message)) {
    return 'Granting the project PM role requires an org admin.';
  }
  return message;
}

/** Add an existing company member to a project with a role. RLS + the member-type
 *  trigger are the hard backstop; this validates for a clean message. */
export async function addProjectMember(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const role = validRole(projectId, String(formData.get('role') ?? ''));
  if (!projectId || !userId) fail(projectId, 'Pick a person and a role.');

  const project = await getProject(projectId);
  if (!project) fail(projectId, 'Project not found.');

  const supabase = await createClient();
  const mt = await memberTypeOf(supabase, project.org_id, userId);
  if (mt && !projectRolesForType(mt).includes(role)) {
    fail(projectId, `A ${MEMBER_TYPE_META[mt].label} can’t be a project ${role}.`);
  }

  const { error } = await supabase
    .from('project_members')
    .insert({ org_id: project.org_id, project_id: projectId, user_id: userId, role });
  if (error) fail(projectId, explain(role, error.message));
  done(projectId, 'added');
}

export async function updateProjectMemberRole(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const role = validRole(projectId, String(formData.get('role') ?? ''));
  if (!projectId || !userId) fail(projectId, 'Missing project or member.');

  const project = await getProject(projectId);
  if (!project) fail(projectId, 'Project not found.');

  const supabase = await createClient();
  const mt = await memberTypeOf(supabase, project.org_id, userId);
  if (mt && !projectRolesForType(mt).includes(role)) {
    fail(projectId, `A ${MEMBER_TYPE_META[mt].label} can’t be a project ${role}.`);
  }

  const { error } = await supabase
    .from('project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) fail(projectId, explain(role, error.message));
  done(projectId);
}

export async function removeProjectMember(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  if (!projectId || !userId) fail(projectId, 'Missing project or member.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) fail(projectId, error.message);
  done(projectId);
}
