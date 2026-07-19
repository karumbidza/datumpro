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

// decideExtension retired — extension approvals now run through the shared
// two-step chain (decideApprovalStep + finalize_approval).
