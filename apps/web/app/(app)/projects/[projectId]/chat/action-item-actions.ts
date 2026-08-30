'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/data/notifications';

type Result = { ok: boolean; error?: string };

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/chat`);
  revalidatePath(`/projects/${projectId}/calendar`);
}

async function assigneeName(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('display_name, email').eq('id', userId).maybeSingle();
  const p = data as { display_name: string | null; email: string | null } | null;
  return p?.display_name || p?.email?.split('@')[0] || 'someone';
}

/** Raise a to-do from the chat: a title, optionally an assignee and a deadline.
 *  Not a formal task — any project member can create one. */
export async function createActionItem(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const detail = (formData.get('detail') as string)?.trim() || null;
  const assigneeId = (formData.get('assigneeId') as string) || null;
  const dueDate = (formData.get('dueDate') as string) || null;
  const conversationId = (formData.get('conversationId') as string) || null;
  const messageId = (formData.get('messageId') as string) || null;
  if (!projectId) return { ok: false, error: 'Missing project.' };
  if (title.length < 2) return { ok: false, error: 'Give the to-do a title.' };

  // org_id comes from the project (the composite FK also enforces this).
  const { data: proj } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  const project = proj as { org_id: string; name: string } | null;
  if (!project) return { ok: false, error: 'Project not found.' };

  const { data: inserted, error } = await supabase
    .from('action_items')
    .insert({
      org_id: project.org_id,
      project_id: projectId,
      conversation_id: conversationId,
      message_id: messageId,
      title,
      detail,
      assignee_id: assigneeId,
      created_by: user.id,
      due_date: dueDate,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  if (assigneeId && assigneeId !== user.id) {
    const by = await assigneeName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: project.org_id,
      userId: assigneeId,
      type: 'action_item_assigned',
      title: `To-do from ${by} — ${project.name}`,
      body: dueDate ? `${title} (due ${dueDate})` : title,
      link: `/projects/${projectId}/chat`,
      entityId: (inserted as { id: string }).id,
    });
  }

  revalidate(projectId);
  return { ok: true };
}

/** Mark an action item done (or reopen it). The assignee, raiser, or a manager may. */
export async function setActionItemDone(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const done = String(formData.get('done') ?? '') === 'true';
  if (!id || !projectId) return { ok: false, error: 'Missing item.' };

  const { data: before } = await supabase
    .from('action_items')
    .select('org_id, title, created_by')
    .eq('id', id)
    .maybeSingle();
  const b = before as { org_id: string; title: string; created_by: string | null } | null;

  const { error } = await supabase
    .from('action_items')
    .update({
      status: done ? 'done' : 'open',
      done_at: done ? new Date().toISOString() : null,
      done_by: done ? user.id : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  // Tell the raiser when someone else completes their ask.
  if (done && b && b.created_by && b.created_by !== user.id) {
    const by = await assigneeName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: b.org_id,
      userId: b.created_by,
      type: 'action_item_done',
      title: `Done — ${b.title}`,
      body: `${by} completed the to-do.`,
      link: `/projects/${projectId}/chat`,
      entityId: id,
    });
  }

  revalidate(projectId);
  return { ok: true };
}

/** Edit a to-do's title/detail/assignee/deadline. Notifies a newly-assigned person. */
export async function updateActionItem(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const detail = (formData.get('detail') as string)?.trim() || null;
  const assigneeId = (formData.get('assigneeId') as string) || null;
  const dueDate = (formData.get('dueDate') as string) || null;
  if (!id || !projectId) return { ok: false, error: 'Missing item.' };
  if (title.length < 2) return { ok: false, error: 'Give the to-do a title.' };

  const { data: before } = await supabase
    .from('action_items')
    .select('org_id, assignee_id')
    .eq('id', id)
    .maybeSingle();
  const b = before as { org_id: string; assignee_id: string | null } | null;

  const { error } = await supabase
    .from('action_items')
    .update({ title, detail, assignee_id: assigneeId, due_date: dueDate, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  if (b && assigneeId && assigneeId !== b.assignee_id && assigneeId !== user.id) {
    const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle();
    const name = (proj as { name: string } | null)?.name ?? 'a project';
    const by = await assigneeName(supabase, user.id);
    await notifyUser(supabase, {
      orgId: b.org_id,
      userId: assigneeId,
      type: 'action_item_assigned',
      title: `To-do from ${by} — ${name}`,
      body: dueDate ? `${title} (due ${dueDate})` : title,
      link: `/projects/${projectId}/chat`,
      entityId: id,
    });
  }

  revalidate(projectId);
  return { ok: true };
}

/** Remove a to-do (raiser or manager). */
export async function deleteActionItem(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const id = String(formData.get('id') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!id || !projectId) return { ok: false, error: 'Missing item.' };

  const { error } = await supabase.from('action_items').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}
