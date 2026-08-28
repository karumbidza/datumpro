import { supabase } from '../supabase';

export type VariationStatus = 'pending' | 'approved' | 'rejected';

/** An item-variation: a subtask flagged `is_variation` on some task in the
 *  project, with its own approval status. Read-only on mobile — raising a
 *  variation is a web/PM flow. */
export interface Variation {
  id: string;
  title: string;
  costCents: number;
  status: VariationStatus;
  taskTitle: string;
}

/** Item-variations across a project, newest first. Selects the variation
 *  subtasks joined to their parent task (by project_id). RLS scopes to project
 *  members. */
export async function listVariations(projectId: string): Promise<Variation[]> {
  const { data } = await supabase
    .from('task_subtasks')
    .select('id, title, cost_cents, variation_status, tasks!inner(title, project_id)')
    .eq('is_variation', true)
    .eq('tasks.project_id', projectId)
    .order('created_at', { ascending: false });

  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    cost_cents: number | null;
    variation_status: VariationStatus | null;
    tasks: { title: string | null } | { title: string | null }[] | null;
  }[]).map((r) => {
    const tk = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
    return {
      id: r.id,
      title: r.title,
      costCents: r.cost_cents ?? 0,
      status: r.variation_status ?? 'pending',
      taskTitle: tk?.title ?? 'Task',
    };
  });
}
