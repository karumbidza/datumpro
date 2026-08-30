import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Rfi, RfiAttachment, RfiPriority, RfiStatus, Discipline } from './rfis-types';

export type { Rfi, RfiAttachment, RfiPriority, RfiStatus, RfiDrawingRef } from './rfis-types';

type RfiRow = {
  id: string;
  number: number;
  project_id: string;
  subject: string;
  detail: string | null;
  discipline: Discipline;
  priority: RfiPriority;
  status: RfiStatus;
  drawing_id: string | null;
  assignee_id: string | null;
  due_date: string | null;
  answer: string | null;
  answered_at: string | null;
  answered_by: string | null;
  raised_by: string | null;
  created_at: string;
  updated_at: string;
};

type AttachmentRow = {
  id: string;
  rfi_id: string;
  storage_path: string;
  filename: string | null;
  caption: string | null;
  uploaded_by: string | null;
};

const RFI_SELECT =
  'id, number, project_id, subject, detail, discipline, priority, status, drawing_id, assignee_id, due_date, answer, answered_at, answered_by, raised_by, created_at, updated_at';

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

/** Every RFI on a project (RLS scopes to members/staff), newest first, each with
 *  its attachments (signed), the people involved, and the referenced drawing. */
export async function listProjectRfis(projectId: string): Promise<Rfi[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('rfis')
    .select(RFI_SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as RfiRow[];
  if (rows.length === 0) return [];

  const { data: attData } = await supabase
    .from('rfi_attachments')
    .select('id, rfi_id, storage_path, filename, caption, uploaded_by')
    .in('rfi_id', rows.map((r) => r.id))
    .order('created_at', { ascending: true });
  const atts = (attData ?? []) as AttachmentRow[];

  const signed = new Map<string, string>();
  const paths = atts.map((a) => a.storage_path);
  if (paths.length) {
    const { data: urls } = await supabase.storage.from('project-media').createSignedUrls(paths, 60 * 60);
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }
  const attByRfi = new Map<string, RfiAttachment[]>();
  for (const a of atts) {
    const arr = attByRfi.get(a.rfi_id) ?? [];
    arr.push({ id: a.id, url: signed.get(a.storage_path) ?? null, filename: a.filename, caption: a.caption, uploadedBy: a.uploaded_by });
    attByRfi.set(a.rfi_id, arr);
  }

  // Referenced drawings (number + title) for the RFIs that cite one.
  const drawingIds = [...new Set(rows.map((r) => r.drawing_id).filter(Boolean))] as string[];
  const drawingById = new Map<string, { number: string; title: string }>();
  if (drawingIds.length) {
    const { data: draws } = await supabase.from('drawings').select('id, number, title').in('id', drawingIds);
    for (const d of (draws ?? []) as { id: string; number: string; title: string }[]) {
      drawingById.set(d.id, { number: d.number, title: d.title });
    }
  }

  const names = await resolveNames(supabase, [
    ...rows.map((r) => r.assignee_id),
    ...rows.map((r) => r.raised_by),
    ...rows.map((r) => r.answered_by),
  ]);

  return rows.map((r) => {
    const draw = r.drawing_id ? drawingById.get(r.drawing_id) : undefined;
    return {
      id: r.id,
      number: r.number,
      projectId: r.project_id,
      subject: r.subject,
      detail: r.detail,
      discipline: r.discipline,
      priority: r.priority,
      status: r.status,
      drawingId: r.drawing_id,
      drawingNumber: draw?.number ?? null,
      drawingTitle: draw?.title ?? null,
      assigneeId: r.assignee_id,
      assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
      dueDate: r.due_date,
      answer: r.answer,
      answeredAt: r.answered_at,
      answeredByName: r.answered_by ? (names.get(r.answered_by) ?? null) : null,
      raisedBy: r.raised_by,
      raisedByName: r.raised_by ? (names.get(r.raised_by) ?? null) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      attachments: attByRfi.get(r.id) ?? [],
    };
  });
}
