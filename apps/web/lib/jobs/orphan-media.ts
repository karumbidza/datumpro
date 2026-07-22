import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'project-media';

/** Belt-and-braces sweep for orphaned BoQ/invoice files: a storage object under a
 *  task's /docs/ folder with no matching task_documents row (e.g. an upload whose
 *  DB insert failed). Delete-at-source already removes files when a doc row is
 *  deleted (remove / withdraw / award), so this only mops up stragglers. A 1-hour
 *  grace window keeps it from touching in-flight uploads. */
export async function runOrphanMediaSweep(): Promise<{ scannedFolders: number; removed: number }> {
  const admin = createAdminClient();
  const { data } = await admin.from('task_documents').select('org_id, project_id, task_id, path');
  const rows = (data ?? []) as { org_id: string; project_id: string; task_id: string; path: string }[];
  const valid = new Set(rows.map((r) => r.path));
  const folders = new Set(rows.map((r) => `${r.org_id}/${r.project_id}/tasks/${r.task_id}/docs`));

  const cutoff = Date.now() - 60 * 60 * 1000;
  let removed = 0;
  for (const folder of folders) {
    const { data: objs } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
    const orphans = ((objs ?? []) as { name: string; created_at?: string }[])
      .filter((o) => {
        const full = `${folder}/${o.name}`;
        if (valid.has(full)) return false;
        const created = o.created_at ? new Date(o.created_at).getTime() : 0;
        return created < cutoff; // spare in-flight uploads
      })
      .map((o) => `${folder}/${o.name}`);
    if (orphans.length > 0) {
      await admin.storage.from(BUCKET).remove(orphans);
      removed += orphans.length;
    }
  }
  return { scannedFolders: folders.size, removed };
}
