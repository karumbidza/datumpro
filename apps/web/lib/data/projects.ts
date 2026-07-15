import { createClient } from '@/lib/supabase/server';
import type { ProjectStatus, ProjectType } from '@datumpro/shared/domain';

/** Row shapes for the columns we select. Replace with generated DB types once
 *  `pnpm db:types` is wired (kept explicit here so the app stays type-safe now). */
export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  code: string | null;
  type: ProjectType;
  status: ProjectStatus;
  client_name: string | null;
  contract_value_cents: number;
  start_date: string | null;
  end_date: string | null;
}


const PROJECT_COLUMNS =
  'id, org_id, name, code, type, status, client_name, contract_value_cents, start_date, end_date';

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

export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectRow | null) ?? null;
}

