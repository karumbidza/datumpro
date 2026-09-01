import { supabase, currentUser } from '../supabase';

export type Urgency = 'low' | 'normal' | 'high' | 'urgent';

/** A lightweight to-do raised on a project (mirrors the web action_items). */
export interface ActionItem {
  id: string;
  projectId: string;
  title: string;
  detail: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  dueDate: string | null;
  urgency: Urgency;
  status: 'open' | 'done';
  createdAt: string;
}

type Row = {
  id: string;
  project_id: string;
  title: string;
  detail: string | null;
  assignee_id: string | null;
  created_by: string | null;
  due_date: string | null;
  urgency: Urgency;
  status: 'open' | 'done';
  created_at: string;
};

const SELECT = 'id, project_id, title, detail, assignee_id, created_by, due_date, urgency, status, created_at';
const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

async function resolveNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
    map.set(p.id, p.display_name || p.email || 'Member');
  }
  return map;
}

/** Every to-do on a project (RLS scopes to members). Open first, then most urgent,
 *  then by due date; done items fall to the bottom by due date. */
export async function listProjectActionItems(projectId: string): Promise<ActionItem[]> {
  const { data } = await supabase
    .from('action_items')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as Row[];
  const names = await resolveNames(rows.flatMap((r) => [r.assignee_id, r.created_by]));
  const items: ActionItem[] = rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    detail: r.detail,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_id ? names.get(r.assignee_id) ?? null : null,
    createdBy: r.created_by,
    createdByName: r.created_by ? names.get(r.created_by) ?? null : null,
    dueDate: r.due_date,
    urgency: r.urgency ?? 'normal',
    status: r.status,
    createdAt: r.created_at,
  }));
  const dueRank = (d: string | null) => d ?? '9999-12-31';
  return items.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (a.status === 'open') {
      const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (u !== 0) return u;
    }
    return dueRank(a.dueDate).localeCompare(dueRank(b.dueDate));
  });
}

/** Whether the current user may manage (owner/admin/pm) — for the completion gate
 *  override and edit/remove affordances. Mirrors the web canModerate. */
export async function canManageTodos(projectId: string): Promise<boolean> {
  const user = await currentUser();
  const me = user?.id ?? null;
  if (!me) return false;
  const { data: proj } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  const orgId = (proj as { org_id: string } | null)?.org_id;
  if (!orgId) return false;
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', me).maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me).maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

async function projectOrgId(projectId: string): Promise<string | null> {
  const { data } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  return (data as { org_id: string } | null)?.org_id ?? null;
}

/** In-app notification to another org member (best-effort). The notify() RPC is
 *  org-membership-guarded and refuses self-notify, matching the web behaviour. */
async function notify(args: {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  projectId: string;
  entityId?: string | null;
}): Promise<void> {
  try {
    await supabase.rpc('notify', {
      p_org: args.orgId,
      p_user: args.userId,
      p_type: args.type,
      p_title: args.title,
      p_body: args.body ?? null,
      p_link: `/projects/${args.projectId}/chat`,
      p_entity_type: 'task',
      p_entity_id: args.entityId ?? null,
    });
  } catch {
    /* best-effort — never break the write that triggered it */
  }
}

export async function createActionItem(args: {
  projectId: string;
  title: string;
  detail?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  urgency: Urgency;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const orgId = await projectOrgId(args.projectId);
  if (!orgId) throw new Error('Project not found.');

  const { data: inserted, error } = await supabase
    .from('action_items')
    .insert({
      org_id: orgId,
      project_id: args.projectId,
      title: args.title.trim(),
      detail: args.detail?.trim() || null,
      assignee_id: args.assigneeId ?? null,
      created_by: user.id,
      due_date: args.dueDate ?? null,
      urgency: args.urgency,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  if (args.assigneeId && args.assigneeId !== user.id) {
    await notify({
      orgId,
      userId: args.assigneeId,
      type: 'action_item_assigned',
      title: `To-do — ${args.title.trim()}`,
      body: args.dueDate ? `${args.title.trim()} (due ${args.dueDate})` : args.title.trim(),
      projectId: args.projectId,
      entityId: (inserted as { id: string }).id,
    });
  }
}

export async function updateActionItem(args: {
  id: string;
  projectId: string;
  title: string;
  detail?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  urgency: Urgency;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');

  const { data: before } = await supabase
    .from('action_items')
    .select('org_id, assignee_id')
    .eq('id', args.id)
    .maybeSingle();
  const b = before as { org_id: string; assignee_id: string | null } | null;

  const { error } = await supabase
    .from('action_items')
    .update({
      title: args.title.trim(),
      detail: args.detail?.trim() || null,
      assignee_id: args.assigneeId ?? null,
      due_date: args.dueDate ?? null,
      urgency: args.urgency,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.id);
  if (error) throw new Error(error.message);

  if (b && args.assigneeId && args.assigneeId !== b.assignee_id && args.assigneeId !== user.id) {
    await notify({
      orgId: b.org_id,
      userId: args.assigneeId,
      type: 'action_item_assigned',
      title: `To-do — ${args.title.trim()}`,
      body: args.dueDate ? `${args.title.trim()} (due ${args.dueDate})` : args.title.trim(),
      projectId: args.projectId,
      entityId: args.id,
    });
  }
}

/** Mark done / reopen. The DB trigger enforces assignee-only completion — if a
 *  non-assignee tries, the update errors and the message is surfaced. */
export async function setActionItemDone(id: string, projectId: string, done: boolean): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');

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
  if (error) throw new Error(error.message);

  if (done && b && b.created_by && b.created_by !== user.id) {
    await notify({
      orgId: b.org_id,
      userId: b.created_by,
      type: 'action_item_done',
      title: `Done — ${b.title}`,
      body: 'Your to-do was completed.',
      projectId,
      entityId: id,
    });
  }
}

export async function deleteActionItem(id: string): Promise<void> {
  const { error } = await supabase.from('action_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
