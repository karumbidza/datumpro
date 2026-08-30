import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { retentionReleaseAt } from '@/lib/data/retention';
import type { Snag, SnagPhoto, SnagSeverity, SnagStatus, ProjectDlp } from './snags-types';

export type { Snag, SnagPhoto, SnagSeverity, SnagStatus, ProjectDlp, SnagContractor } from './snags-types';

type SnagRow = {
  id: string;
  number: number;
  project_id: string;
  task_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  severity: SnagSeverity;
  status: SnagStatus;
  assignee_id: string | null;
  due_date: string | null;
  fixed_at: string | null;
  verified_at: string | null;
  retention_deduction_id: string | null;
  raised_by: string | null;
  created_at: string;
  updated_at: string;
};

type PhotoRow = {
  id: string;
  snag_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
};

const SNAG_SELECT =
  'id, number, project_id, task_id, title, description, location, severity, status, assignee_id, due_date, fixed_at, verified_at, retention_deduction_id, raised_by, created_at, updated_at';

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

/** Every snag on a project (RLS scopes to members/staff), newest first, each with
 *  its photos (signed for an hour), the assignee & raiser names, and the amount of
 *  any linked retention deduction. */
export async function listProjectSnags(projectId: string): Promise<Snag[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('snags')
    .select(SNAG_SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as SnagRow[];
  if (rows.length === 0) return [];

  const { data: photoRows } = await supabase
    .from('snag_photos')
    .select('id, snag_id, storage_path, caption, uploaded_by')
    .in('snag_id', rows.map((r) => r.id))
    .order('created_at', { ascending: true });
  const photos = (photoRows ?? []) as PhotoRow[];

  const signed = new Map<string, string>();
  if (photos.length) {
    const paths = photos.map((p) => p.storage_path);
    const { data: urls } = await supabase.storage.from('project-media').createSignedUrls(paths, 60 * 60);
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }
  const photosBySnag = new Map<string, SnagPhoto[]>();
  for (const p of photos) {
    const arr = photosBySnag.get(p.snag_id) ?? [];
    arr.push({ id: p.id, url: signed.get(p.storage_path) ?? null, caption: p.caption, uploadedBy: p.uploaded_by });
    photosBySnag.set(p.snag_id, arr);
  }

  // Amounts for any linked retention deductions (RLS lets staff/PM/finance/the
  // contractor read them; others just see the status without a figure).
  const dedIds = [...new Set(rows.map((r) => r.retention_deduction_id).filter(Boolean))] as string[];
  const dedAmount = new Map<string, number>();
  if (dedIds.length) {
    const { data: ded } = await supabase
      .from('retention_deductions')
      .select('id, amount_cents')
      .in('id', dedIds);
    for (const d of (ded ?? []) as { id: string; amount_cents: number }[]) dedAmount.set(d.id, d.amount_cents);
  }

  const names = await resolveNames(supabase, [
    ...rows.map((r) => r.assignee_id),
    ...rows.map((r) => r.raised_by),
  ]);

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    projectId: r.project_id,
    taskId: r.task_id,
    title: r.title,
    description: r.description,
    location: r.location,
    severity: r.severity,
    status: r.status,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
    dueDate: r.due_date,
    fixedAt: r.fixed_at,
    verifiedAt: r.verified_at,
    retentionDeductionId: r.retention_deduction_id,
    deductionAmountCents: r.retention_deduction_id ? (dedAmount.get(r.retention_deduction_id) ?? null) : null,
    raisedBy: r.raised_by,
    raisedByName: r.raised_by ? (names.get(r.raised_by) ?? null) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    photos: photosBySnag.get(r.id) ?? [],
  }));
}

/** The project's defects-liability-period position, for the register banner. */
export async function getProjectDlp(projectId: string): Promise<ProjectDlp> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('projects')
    .select('retention_period_months, practical_completion_at')
    .eq('id', projectId)
    .maybeSingle();
  const p = (data ?? null) as { retention_period_months: number | null; practical_completion_at: string | null } | null;
  const practicalCompletionAt = p?.practical_completion_at ?? null;
  const releaseAt = retentionReleaseAt(practicalCompletionAt, p?.retention_period_months ?? null);
  const inDlp = !!releaseAt && Date.now() < new Date(releaseAt).getTime();
  return { practicalCompletionAt, releaseAt, inDlp };
}
