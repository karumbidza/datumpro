import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { ProjectStatus, ProjectType, TaskPriority } from '@datumpro/shared/domain';

/** Row shapes for the columns we select. Replace with generated DB types once
 *  `pnpm db:types` is wired (kept explicit here so the app stays type-safe now). */
export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  code: string | null;
  type: ProjectType;
  status: ProjectStatus;
  description: string | null;
  priority: TaskPriority;
  client_name: string | null;
  contract_value_cents: number;
  start_date: string | null;
  end_date: string | null;
}


const PROJECT_COLUMNS =
  'id, org_id, name, code, type, status, description, priority, client_name, contract_value_cents, start_date, end_date';

/** RLS scopes every query to the caller's orgs — no manual org filter needed. */
export async function listProjects(): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

/** A single project by id. Memoised per request (React.cache): a project page and
 *  its notFound()/org-id lookups share one query instead of repeating it. */
export const getProject = cache(async (projectId: string): Promise<ProjectRow | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectRow | null) ?? null;
});

/** Full editable field set for the Project set up screen (superset of ProjectRow).
 *  Kept separate from getProject so list/summary queries stay lean. */
export interface ProjectEditRow extends ProjectRow {
  construction_type: string | null;
  currency: string;
  client_id: string | null;
  start_date: string | null;
  duration_working_days: number | null;
  retention_pct: number | null;
  retention_period_months: number | null;
  practical_completion_at: string | null;
  payment_terms_days: number | null;
  latitude: number | null;
  longitude: number | null;
}

const PROJECT_EDIT_COLUMNS =
  `${PROJECT_COLUMNS}, construction_type, currency, client_id, duration_working_days, retention_pct, retention_period_months, practical_completion_at, payment_terms_days, latitude, longitude`;

export async function getProjectForEdit(projectId: string): Promise<ProjectEditRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_EDIT_COLUMNS)
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectEditRow | null) ?? null;
}

