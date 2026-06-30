import { createClient } from '@/lib/supabase/server';
import type { ProjectStatus, ProjectType, MilestoneStatus, ReportStatus } from '@datumpro/shared/domain';

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

export interface MilestoneRow {
  id: string;
  name: string;
  target_date: string | null;
  status: MilestoneStatus;
}

export interface SiteReportRow {
  id: string;
  report_date: string;
  progress_pct: number;
  narrative: string | null;
  weather: string | null;
  status: ReportStatus;
  author_id: string;
  created_at: string;
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

export async function listMilestones(projectId: string): Promise<MilestoneRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('milestones')
    .select('id, name, target_date, status')
    .eq('project_id', projectId)
    .order('target_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MilestoneRow[];
}

export async function listRecentReports(projectId: string, limit = 20): Promise<SiteReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_reports')
    .select('id, report_date, progress_pct, narrative, weather, status, author_id, created_at')
    .eq('project_id', projectId)
    .order('report_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SiteReportRow[];
}
