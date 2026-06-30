'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { PROJECT_ROLES, type ProjectRole } from '@datumpro/shared/access';

function parseRole(value: FormDataEntryValue | null): ProjectRole {
  const role = String(value ?? '');
  if (!(PROJECT_ROLES as readonly string[]).includes(role)) {
    throw new Error('Invalid project role');
  }
  return role as ProjectRole;
}

/** Add an existing company member to a project with a role. RLS (can_manage_project)
 *  rejects anyone who isn't an org admin or the project's PM. */
export async function addProjectMember(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const role = parseRole(formData.get('role'));
  if (!projectId || !userId) throw new Error('Missing project or member');

  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_members')
    .insert({ org_id: project.org_id, project_id: projectId, user_id: userId, role });
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/team`);
}

export async function updateProjectMemberRole(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const role = parseRole(formData.get('role'));
  if (!projectId || !userId) throw new Error('Missing project or member');

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/team`);
}

export async function removeProjectMember(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  if (!projectId || !userId) throw new Error('Missing project or member');

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/team`);
}
