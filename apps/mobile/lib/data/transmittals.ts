import { supabase, currentUser } from '../supabase';
import { listProjectDrawings } from './drawings';

export type TransmittalPurpose = 'for_construction' | 'for_review' | 'for_approval' | 'for_information' | 'for_record';
export type TransmittalMethod = 'email' | 'hand' | 'courier' | 'portal' | 'other';

export const PURPOSES: TransmittalPurpose[] = ['for_construction', 'for_review', 'for_approval', 'for_information', 'for_record'];
export const METHODS: TransmittalMethod[] = ['email', 'hand', 'courier', 'portal', 'other'];
export const PURPOSE_LABEL: Record<TransmittalPurpose, string> = {
  for_construction: 'For construction',
  for_review: 'For review',
  for_approval: 'For approval',
  for_information: 'For information',
  for_record: 'For record',
};
export const METHOD_LABEL: Record<TransmittalMethod, string> = {
  email: 'Email',
  hand: 'By hand',
  courier: 'Courier',
  portal: 'Portal',
  other: 'Other',
};

export interface TransmittalItem {
  id: string;
  drawingNumber: string;
  revision: string | null;
  title: string | null;
}

export interface Transmittal {
  id: string;
  number: number;
  recipient: string;
  recipientUserId: string | null;
  purpose: TransmittalPurpose;
  method: TransmittalMethod;
  issuedDate: string;
  notes: string | null;
  issuedByName: string | null;
  items: TransmittalItem[];
}

/** A drawing revision available to transmit — each drawing's current sheet. */
export interface IssuableDrawing {
  revisionId: string;
  number: string;
  revision: string;
  title: string;
}

type TransmittalRow = {
  id: string;
  number: number;
  recipient: string;
  recipient_user_id: string | null;
  purpose: TransmittalPurpose;
  method: TransmittalMethod;
  issued_date: string;
  notes: string | null;
  issued_by: string | null;
};

const SELECT = 'id, number, recipient, recipient_user_id, purpose, method, issued_date, notes, issued_by';

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

export async function listProjectTransmittals(projectId: string): Promise<Transmittal[]> {
  const { data } = await supabase
    .from('transmittals')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('number', { ascending: false });
  const rows = (data ?? []) as TransmittalRow[];
  if (rows.length === 0) return [];

  const { data: itemData } = await supabase
    .from('transmittal_items')
    .select('id, transmittal_id, drawing_number, revision, title')
    .in(
      'transmittal_id',
      rows.map((r) => r.id),
    )
    .order('drawing_number', { ascending: true });
  const items = (itemData ?? []) as { id: string; transmittal_id: string; drawing_number: string; revision: string | null; title: string | null }[];

  const byT = new Map<string, TransmittalItem[]>();
  for (const i of items) {
    const arr = byT.get(i.transmittal_id) ?? [];
    arr.push({ id: i.id, drawingNumber: i.drawing_number, revision: i.revision, title: i.title });
    byT.set(i.transmittal_id, arr);
  }

  const names = await resolveNames(rows.map((r) => r.issued_by));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    recipient: r.recipient,
    recipientUserId: r.recipient_user_id,
    purpose: r.purpose,
    method: r.method,
    issuedDate: r.issued_date,
    notes: r.notes,
    issuedByName: r.issued_by ? names.get(r.issued_by) ?? null : null,
    items: byT.get(r.id) ?? [],
  }));
}

/** Each drawing's current sheet — the revisions you can transmit. */
export async function listIssuableDrawings(projectId: string): Promise<IssuableDrawing[]> {
  const drawings = await listProjectDrawings(projectId);
  const out: IssuableDrawing[] = [];
  for (const d of drawings) {
    if (!d.current) continue;
    out.push({ revisionId: d.current.id, number: d.number, revision: d.current.revision, title: d.title });
  }
  return out;
}

async function projectOrg(projectId: string): Promise<{ orgId: string; name: string } | null> {
  const { data } = await supabase.from('projects').select('org_id, name').eq('id', projectId).maybeSingle();
  const p = data as { org_id: string; name: string } | null;
  return p ? { orgId: p.org_id, name: p.name } : null;
}

/** owner/admin/pm — transmittals are manager-only (also enforced by the DB). */
export async function canManageProject(projectId: string): Promise<boolean> {
  const user = await currentUser();
  const me = user?.id ?? null;
  if (!me) return false;
  const proj = await projectOrg(projectId);
  if (!proj) return false;
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', proj.orgId).eq('user_id', me).eq('status', 'active').maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me).maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

export async function createTransmittal(args: {
  projectId: string;
  recipient: string;
  recipientUserId: string | null;
  purpose: TransmittalPurpose;
  method: TransmittalMethod;
  issuedDate: string;
  notes?: string | null;
  drawings: IssuableDrawing[];
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  if (args.recipient.trim().length < 2) throw new Error('Who is it going to?');
  if (args.drawings.length === 0) throw new Error('Add at least one drawing to transmit.');
  const proj = await projectOrg(args.projectId);
  if (!proj) throw new Error('Project not found.');

  const { data, error } = await supabase
    .from('transmittals')
    .insert({
      org_id: proj.orgId,
      project_id: args.projectId,
      recipient: args.recipient.trim(),
      recipient_user_id: args.recipientUserId,
      purpose: args.purpose,
      method: args.method,
      issued_date: args.issuedDate,
      notes: args.notes?.trim() || null,
      issued_by: user.id,
    })
    .select('id, number')
    .single();
  if (error) throw new Error(error.message);
  const tr = data as { id: string; number: number };

  const { error: itemErr } = await supabase.from('transmittal_items').insert(
    args.drawings.map((d) => ({
      transmittal_id: tr.id,
      org_id: proj.orgId,
      project_id: args.projectId,
      drawing_revision_id: d.revisionId,
      drawing_number: d.number,
      revision: d.revision,
      title: d.title,
    })),
  );
  if (itemErr) throw new Error(itemErr.message);

  if (args.recipientUserId && args.recipientUserId !== user.id) {
    try {
      await supabase.rpc('notify', {
        p_org: proj.orgId,
        p_user: args.recipientUserId,
        p_type: 'transmittal_issued',
        p_title: `Transmittal TR-${String(tr.number).padStart(3, '0')} — ${proj.name}`,
        p_body: `${args.drawings.length} drawing${args.drawings.length === 1 ? '' : 's'}`,
        p_link: `/projects/${args.projectId}/transmittals`,
        p_entity_type: 'task',
        p_entity_id: tr.id,
      });
    } catch {
      /* best-effort */
    }
  }
}

export async function updateTransmittal(args: {
  id: string;
  recipient: string;
  recipientUserId: string | null;
  purpose: TransmittalPurpose;
  method: TransmittalMethod;
  issuedDate: string;
  notes?: string | null;
}): Promise<void> {
  if (args.recipient.trim().length < 2) throw new Error('Who is it going to?');
  const { error } = await supabase
    .from('transmittals')
    .update({
      recipient: args.recipient.trim(),
      recipient_user_id: args.recipientUserId,
      purpose: args.purpose,
      method: args.method,
      issued_date: args.issuedDate,
      notes: args.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.id);
  if (error) throw new Error(error.message);
}

export async function deleteTransmittal(id: string): Promise<void> {
  const { error } = await supabase.from('transmittals').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
