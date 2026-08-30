import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Drawing, DrawingRevision, Discipline, RevisionStatus } from './drawings-types';

export type { Drawing, DrawingRevision, Discipline, RevisionStatus } from './drawings-types';

type DrawingRow = {
  id: string;
  number: string;
  title: string;
  discipline: Discipline;
  created_by: string | null;
  updated_at: string;
};

type RevisionRow = {
  id: string;
  drawing_id: string;
  revision: string;
  status: RevisionStatus;
  issue_date: string | null;
  storage_path: string | null;
  filename: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
};

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

/** The project's drawing register (RLS scopes to members/staff): each drawing
 *  with its current sheet and full revision history, PDFs signed for an hour. */
export async function listProjectDrawings(projectId: string): Promise<Drawing[]> {
  const supabase = await createClient();
  const { data: drawingData } = await supabase
    .from('drawings')
    .select('id, number, title, discipline, created_by, updated_at')
    .eq('project_id', projectId)
    .order('number', { ascending: true });
  const drawings = (drawingData ?? []) as DrawingRow[];
  if (drawings.length === 0) return [];

  const { data: revData } = await supabase
    .from('drawing_revisions')
    .select('id, drawing_id, revision, status, issue_date, storage_path, filename, notes, uploaded_by, created_at')
    .in('drawing_id', drawings.map((d) => d.id))
    .order('created_at', { ascending: false });
  const revs = (revData ?? []) as RevisionRow[];

  // One batched sign for every PDF path.
  const signed = new Map<string, string>();
  const paths = revs.map((r) => r.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    const { data: urls } = await supabase.storage.from('project-media').createSignedUrls(paths, 60 * 60);
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  const names = await resolveNames(supabase, [
    ...drawings.map((d) => d.created_by),
    ...revs.map((r) => r.uploaded_by),
  ]);

  const toRevision = (r: RevisionRow): DrawingRevision => ({
    id: r.id,
    revision: r.revision,
    status: r.status,
    issueDate: r.issue_date,
    url: r.storage_path ? (signed.get(r.storage_path) ?? null) : null,
    filename: r.filename,
    notes: r.notes,
    uploadedByName: r.uploaded_by ? (names.get(r.uploaded_by) ?? null) : null,
    createdAt: r.created_at,
  });

  const revsByDrawing = new Map<string, DrawingRevision[]>();
  for (const r of revs) {
    const arr = revsByDrawing.get(r.drawing_id) ?? [];
    arr.push(toRevision(r));
    revsByDrawing.set(r.drawing_id, arr);
  }

  return drawings.map((d) => {
    const revisions = revsByDrawing.get(d.id) ?? []; // already newest-first
    const current = revisions.find((r) => r.status !== 'superseded') ?? revisions[0] ?? null;
    return {
      id: d.id,
      number: d.number,
      title: d.title,
      discipline: d.discipline,
      createdByName: d.created_by ? (names.get(d.created_by) ?? null) : null,
      updatedAt: d.updated_at,
      current,
      revisions,
    };
  });
}
