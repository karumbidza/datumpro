import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** Daily burn-up capture: writes each active project's current % into
 *  project_progress_snapshots, one row per project per day. Idempotent — a second
 *  run on the same day overwrites that day's value (upsert on project_id,day), so
 *  re-runs and retries are safe. Uses the same `project_progress` RPC that drives
 *  the live bar, so the trend and the headline number never disagree. */
export async function runProgressSnapshot(now: Date = new Date()): Promise<{ captured: number }> {
  const admin = createAdminClient();
  const day = now.toISOString().slice(0, 10);

  // Only projects that are actually running — no point trending archived/draft work.
  const { data: projects } = await admin
    .from('projects')
    .select('id, org_id')
    .in('status', ['planning', 'active', 'on_hold']);

  const rows = projects ?? [];
  const snapshots: { org_id: string; project_id: string; day: string; pct: number }[] = [];
  for (const p of rows as { id: string; org_id: string }[]) {
    const { data } = await admin.rpc('project_progress', { p_project_id: p.id });
    snapshots.push({
      org_id: p.org_id,
      project_id: p.id,
      day,
      pct: typeof data === 'number' ? data : 0,
    });
  }

  if (snapshots.length > 0) {
    await admin
      .from('project_progress_snapshots')
      .upsert(snapshots, { onConflict: 'project_id,day' });
  }

  return { captured: snapshots.length };
}
