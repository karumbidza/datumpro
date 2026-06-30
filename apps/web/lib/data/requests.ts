import { createClient } from '@/lib/supabase/server';
import type { RequestType, RequestStatus, ApprovalDecision } from '@datumpro/shared/domain';

export interface RequestRow {
  id: string;
  org_id: string;
  project_id: string;
  type: RequestType;
  title: string;
  description: string | null;
  amount_cents: number | null;
  status: RequestStatus;
  raised_by: string | null;
  created_at: string;
}

export interface ApprovalRow {
  id: string;
  step_order: number;
  approver_role: string;
  approver_id: string | null;
  decision: ApprovalDecision;
  comment: string | null;
  decided_at: string | null;
}

const REQUEST_COLUMNS =
  'id, org_id, project_id, type, title, description, amount_cents, status, raised_by, created_at';

export async function listRequestsByProject(projectId: string): Promise<RequestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('requests')
    .select(REQUEST_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RequestRow[];
}

export async function getRequestDetail(
  requestId: string,
): Promise<{ request: RequestRow; approvals: ApprovalRow[] } | null> {
  const supabase = await createClient();
  const { data: request } = await supabase
    .from('requests')
    .select(REQUEST_COLUMNS)
    .eq('id', requestId)
    .maybeSingle();
  if (!request) return null;

  const { data: approvals } = await supabase
    .from('approvals')
    .select('id, step_order, approver_role, approver_id, decision, comment, decided_at')
    .eq('request_id', requestId)
    .order('step_order', { ascending: true });

  return { request: request as RequestRow, approvals: (approvals ?? []) as ApprovalRow[] };
}
