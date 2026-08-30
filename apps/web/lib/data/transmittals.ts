import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { listProjectDrawings } from '@/lib/data/drawings';
import type {
  Transmittal,
  TransmittalItem,
  TransmittalPurpose,
  TransmittalMethod,
  TransmittalDrawingOption,
} from './transmittals-types';

export type {
  Transmittal,
  TransmittalItem,
  TransmittalPurpose,
  TransmittalMethod,
  TransmittalDrawingOption,
} from './transmittals-types';

type TransmittalRow = {
  id: string;
  number: number;
  project_id: string;
  recipient: string;
  recipient_user_id: string | null;
  purpose: TransmittalPurpose;
  method: TransmittalMethod;
  issued_date: string;
  notes: string | null;
  issued_by: string | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  transmittal_id: string;
  drawing_revision_id: string | null;
  drawing_number: string;
  revision: string | null;
  title: string | null;
};

const SELECT =
  'id, number, project_id, recipient, recipient_user_id, purpose, method, issued_date, notes, issued_by, created_at';

async function resolveNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
    map.set(p.id, p.display_name || p.email || 'Member');
  }
  return map;
}

/** Every transmittal on a project (RLS scopes to members/staff), newest first,
 *  each with its issued items and the issuer's name. */
export async function listProjectTransmittals(projectId: string): Promise<Transmittal[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('transmittals')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('number', { ascending: false });
  const rows = (data ?? []) as TransmittalRow[];
  if (rows.length === 0) return [];

  const { data: itemData } = await supabase
    .from('transmittal_items')
    .select('id, transmittal_id, drawing_revision_id, drawing_number, revision, title')
    .in('transmittal_id', rows.map((r) => r.id))
    .order('drawing_number', { ascending: true });
  const items = (itemData ?? []) as ItemRow[];

  const itemsByTransmittal = new Map<string, TransmittalItem[]>();
  for (const i of items) {
    const arr = itemsByTransmittal.get(i.transmittal_id) ?? [];
    arr.push({
      id: i.id,
      drawingRevisionId: i.drawing_revision_id,
      drawingNumber: i.drawing_number,
      revision: i.revision,
      title: i.title,
    });
    itemsByTransmittal.set(i.transmittal_id, arr);
  }

  const names = await resolveNames(supabase, rows.map((r) => r.issued_by));

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    projectId: r.project_id,
    recipient: r.recipient,
    recipientUserId: r.recipient_user_id,
    purpose: r.purpose,
    method: r.method,
    issuedDate: r.issued_date,
    notes: r.notes,
    issuedByName: r.issued_by ? (names.get(r.issued_by) ?? null) : null,
    createdAt: r.created_at,
    items: itemsByTransmittal.get(r.id) ?? [],
  }));
}

/** The drawing revisions available to transmit — each drawing's current sheet. */
export async function listIssuableDrawings(projectId: string): Promise<TransmittalDrawingOption[]> {
  const drawings = await listProjectDrawings(projectId);
  const out: TransmittalDrawingOption[] = [];
  for (const d of drawings) {
    if (!d.current) continue;
    out.push({ revisionId: d.current.id, number: d.number, revision: d.current.revision, title: d.title, status: d.current.status });
  }
  return out;
}
