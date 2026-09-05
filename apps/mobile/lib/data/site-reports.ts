import { decode } from 'base64-arraybuffer';
import { supabase, currentUser } from '../supabase';
import { assertUploadSize, MAX_PROJECT_MEDIA_BYTES } from '../upload-limits';

const BUCKET = 'project-media';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'wind' | 'heat';
export type ReportStatus = 'draft' | 'submitted';

export const WEATHER_OPTIONS: Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'wind', 'heat'];
export const WEATHER_LABEL: Record<Weather, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  storm: 'Storm',
  wind: 'Wind',
  heat: 'Heat',
};

export interface ReportPhoto {
  id: string;
  url: string | null;
}

export interface SiteReport {
  id: string;
  reportDate: string; // YYYY-MM-DD
  progressPct: number;
  narrative: string | null;
  weather: Weather | null;
  status: ReportStatus;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  photos: ReportPhoto[];
}

type Row = {
  id: string;
  report_date: string;
  progress_pct: number;
  narrative: string | null;
  weather: Weather | null;
  status: ReportStatus;
  author_id: string | null;
  created_at: string;
};

const SELECT = 'id, report_date, progress_pct, narrative, weather, status, author_id, created_at';

async function resolveNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from('profiles').select('id, display_name, email').in('id', unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
    map.set(p.id, p.display_name || p.email || 'Member');
  }
  return map;
}

/** Site reports on a project (newest date first). RLS: every project member sees
 *  the project's reports (SELECT is org-scoped); only the author or a manager may
 *  write, and only a manager may delete. Photos signed for an hour. */
export async function listProjectSiteReports(projectId: string): Promise<SiteReport[]> {
  const { data } = await supabase
    .from('site_reports')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('report_date', { ascending: false });
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const { data: mediaRows } = await supabase
    .from('report_media')
    .select('id, report_id, storage_path')
    .in(
      'report_id',
      rows.map((r) => r.id),
    )
    .order('created_at', { ascending: true });
  const media = (mediaRows ?? []) as { id: string; report_id: string; storage_path: string }[];

  const signed = new Map<string, string>();
  if (media.length) {
    const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(
      media.map((m) => m.storage_path),
      60 * 60,
    );
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }
  const byReport = new Map<string, ReportPhoto[]>();
  for (const m of media) {
    const arr = byReport.get(m.report_id) ?? [];
    arr.push({ id: m.id, url: signed.get(m.storage_path) ?? null });
    byReport.set(m.report_id, arr);
  }

  const names = await resolveNames(rows.map((r) => r.author_id));
  return rows.map((r) => ({
    id: r.id,
    reportDate: r.report_date,
    progressPct: r.progress_pct,
    narrative: r.narrative,
    weather: r.weather,
    status: r.status,
    authorId: r.author_id,
    authorName: r.author_id ? names.get(r.author_id) ?? null : null,
    createdAt: r.created_at,
    photos: byReport.get(r.id) ?? [],
  }));
}

async function projectOrg(projectId: string): Promise<string | null> {
  const { data } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  return (data as { org_id: string } | null)?.org_id ?? null;
}

/** owner/admin/pm — used to let a manager see/act beyond their own reports. */
export async function canManageProject(projectId: string): Promise<boolean> {
  const user = await currentUser();
  const me = user?.id ?? null;
  if (!me) return false;
  const orgId = await projectOrg(projectId);
  if (!orgId) return false;
  const [{ data: orgRow }, { data: projRow }] = await Promise.all([
    supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', me).eq('status', 'active').maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', me).maybeSingle(),
  ]);
  const orgRole = (orgRow as { role: string } | null)?.role ?? null;
  const projectRole = (projRow as { role: string } | null)?.role ?? null;
  return orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
}

/** Create a site report (draft or submitted). org_id is resolved from the project.
 *  Returns the new id so photos can be attached. */
export async function createSiteReport(args: {
  projectId: string;
  reportDate: string;
  progressPct: number;
  narrative?: string | null;
  weather?: Weather | null;
  status: ReportStatus;
}): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  const orgId = await projectOrg(args.projectId);
  if (!orgId) throw new Error('Project not found.');
  const pct = Math.max(0, Math.min(100, Math.round(args.progressPct)));

  const { data, error } = await supabase
    .from('site_reports')
    .insert({
      org_id: orgId,
      project_id: args.projectId,
      author_id: user.id,
      report_date: args.reportDate,
      progress_pct: pct,
      narrative: args.narrative?.trim() || null,
      weather: args.weather ?? null,
      status: args.status,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function submitSiteReport(id: string): Promise<void> {
  const { error } = await supabase.from('site_reports').update({ status: 'submitted' }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteSiteReport(id: string): Promise<void> {
  const { error } = await supabase.from('site_reports').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Upload a captured photo to project-media and record it against the report. */
export async function addReportPhoto(params: {
  reportId: string;
  projectId: string;
  base64: string;
  ext: string;
  mime: string;
}): Promise<void> {
  const orgId = await projectOrg(params.projectId);
  if (!orgId) throw new Error('Project not found.');
  assertUploadSize(params.base64, MAX_PROJECT_MEDIA_BYTES, 'This photo');
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${params.ext}`;
  const path = `${orgId}/${params.projectId}/${params.reportId}/${name}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(params.base64), { contentType: params.mime, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error } = await supabase.from('report_media').insert({
    org_id: orgId,
    project_id: params.projectId,
    report_id: params.reportId,
    storage_path: path,
    media_type: 'image',
    captured_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
