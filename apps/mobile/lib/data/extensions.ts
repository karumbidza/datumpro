import { supabase, currentUser} from '../supabase';

export type ExtensionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ExtensionRequest {
  id: string;
  proposedDueDate: string;
  reason: string | null;
  status: ExtensionStatus;
  requesterName: string | null;
}

/** Extension requests on a task, newest first, with the requester's name. */
export async function listExtensions(taskId: string): Promise<ExtensionRequest[]> {
  const { data } = await supabase
    .from('task_extension_requests')
    .select('id, proposed_due_date, reason, status, requested_by')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  const raw = (data ?? []) as {
    id: string;
    proposed_due_date: string;
    reason: string | null;
    status: ExtensionStatus;
    requested_by: string | null;
  }[];

  const ids = [...new Set(raw.map((r) => r.requested_by).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name, email').in('id', ids);
    names = new Map(
      ((profs ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
        p.id,
        p.display_name || p.email || 'Member',
      ]),
    );
  }

  return raw.map((r) => ({
    id: r.id,
    proposedDueDate: r.proposed_due_date,
    reason: r.reason,
    status: r.status,
    requesterName: r.requested_by ? names.get(r.requested_by) ?? null : null,
  }));
}

/** Assignee/contractor asks for a new due date. RLS: project member, requester = self. */
export async function requestExtension(params: {
  taskId: string;
  orgId: string;
  projectId: string;
  proposedDueDate: string;
  reason?: string | null;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('task_extension_requests').insert({
    org_id: params.orgId,
    project_id: params.projectId,
    task_id: params.taskId,
    requested_by: user.id,
    proposed_due_date: params.proposedDueDate,
    reason: params.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

/** PM approves (shifts the task deadline) or rejects. RLS restricts the update
 *  to a manager; the deadline shift mirrors the web decideExtension. */
export async function decideExtension(params: {
  requestId: string;
  taskId: string;
  approve: boolean;
}): Promise<void> {
  const user = await currentUser();

  const { data: req } = await supabase
    .from('task_extension_requests')
    .select('proposed_due_date')
    .eq('id', params.requestId)
    .maybeSingle();
  const proposed = (req as { proposed_due_date: string } | null)?.proposed_due_date ?? null;

  const { error } = await supabase
    .from('task_extension_requests')
    .update({
      status: params.approve ? 'approved' : 'rejected',
      decided_by: user?.id ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq('id', params.requestId)
    .eq('task_id', params.taskId);
  if (error) throw new Error(error.message);

  if (params.approve && proposed) {
    await supabase
      .from('tasks')
      .update({ due_date: proposed, planned_end_date: proposed })
      .eq('id', params.taskId);
  }
}
