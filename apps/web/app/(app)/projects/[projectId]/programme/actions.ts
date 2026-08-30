'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: boolean; error?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

function isBackdated(startDate: string): boolean {
  return startDate < new Date().toISOString().slice(0, 10);
}

/** Move a task's bar on the programme: sets the planned window and keeps the due
 *  date equal to the end (the app-wide "end IS the due date" rule). RLS only lets
 *  a manager (PM / org staff) write, and the no-backdating floor is enforced. */
export async function rescheduleTask(formData: FormData): Promise<Result> {
  const { supabase } = await requireUser();
  const taskId = String(formData.get('taskId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const start = String(formData.get('plannedStartDate') ?? '').trim();
  const end = String(formData.get('plannedEndDate') ?? '').trim();
  if (!taskId || !projectId) return { ok: false, error: 'Missing task.' };
  if (!start || Number.isNaN(Date.parse(start))) return { ok: false, error: 'Pick a start date.' };
  if (!end || Number.isNaN(Date.parse(end))) return { ok: false, error: 'Pick an end date.' };
  if (end < start) return { ok: false, error: 'The end date can’t be before the start.' };
  if (isBackdated(start)) return { ok: false, error: 'The start date can’t be in the past.' };

  const { error } = await supabase
    .from('tasks')
    .update({ planned_start_date: start, planned_end_date: end, due_date: end })
    .eq('id', taskId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${projectId}/programme`);
  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  return { ok: true };
}
