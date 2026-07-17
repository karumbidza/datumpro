'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createSiteReportSchema } from '@datumpro/shared/validation';
import { clampProgress } from '@datumpro/shared/domain';
import type { FormState } from '@/components/ui/form-error';

/** Creates a site report from the web form. RLS enforces tenant + author rules on
 *  the insert; we still resolve org_id server-side from the project so the client
 *  can't spoof it. Media capture is primarily the mobile slice. */
export async function createReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const projectId = String(formData.get('projectId') ?? '');
  const intent = String(formData.get('intent') ?? 'draft');

  const parsed = createSiteReportSchema.safeParse({
    projectId,
    reportDate: String(formData.get('reportDate') ?? ''),
    progressPct: clampProgress(Number(formData.get('progressPct') ?? 0)),
    narrative: (formData.get('narrative') as string) || undefined,
    weather: (formData.get('weather') as string) || undefined,
    status: intent === 'submitted' ? 'submitted' : 'draft',
  });
  if (!parsed.success) {
    return { error: `Invalid report: ${parsed.error.issues.map((i) => i.message).join(', ')}` };
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .maybeSingle();
  if (projectError) return { error: projectError.message };
  if (!project) return { error: 'Project not found or access denied.' };

  const { error } = await supabase.from('site_reports').insert({
    org_id: (project as { org_id: string }).org_id,
    project_id: projectId,
    author_id: user.id,
    report_date: parsed.data.reportDate,
    progress_pct: parsed.data.progressPct,
    narrative: parsed.data.narrative ?? null,
    weather: parsed.data.weather ?? null,
    status: parsed.data.status,
  });
  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}
