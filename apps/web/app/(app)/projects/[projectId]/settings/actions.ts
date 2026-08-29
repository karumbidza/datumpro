'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { notifyRetentionReleaseScheduled } from '@/lib/data/notifications';
import {
  PROJECT_STATUSES, CONSTRUCTION_TYPES, CURRENCIES, type ProjectStatus,
} from '@datumpro/shared/domain';
import { TASK_PRIORITIES } from '@datumpro/shared/domain';

const tabPath = (projectId: string, tab: string) => `/projects/${projectId}/settings?tab=${tab}`;

/** Expected failures redirect back to the tab with an inline banner (a thrown
 *  error would hit the full-page boundary). */
function fail(projectId: string, tab: string, message: string): never {
  redirect(`${tabPath(projectId, tab)}&error=${encodeURIComponent(message)}`);
}
function done(projectId: string, tab: string): never {
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}`);
  redirect(`${tabPath(projectId, tab)}&saved=1`);
}

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Details: name, description, priority, construction type, client, schedule.
 *  end_date is derived by a DB trigger from start_date + duration. */
export async function updateProjectDetails(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const project = await getProject(projectId);
  if (!project) fail(projectId, 'details', 'Project not found.');

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) fail(projectId, 'details', 'Enter a project name (at least 2 characters).');

  const description = String(formData.get('description') ?? '').trim().slice(0, 2000) || null;
  const priority = String(formData.get('priority') ?? 'medium');
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) fail(projectId, 'details', 'Invalid priority.');
  const constructionType = String(formData.get('constructionType') ?? '');
  if (!(CONSTRUCTION_TYPES as readonly string[]).includes(constructionType)) fail(projectId, 'details', 'Pick a construction type.');
  const startDate = String(formData.get('startDate') ?? '') || null;
  const durationDays = num(formData.get('durationWorkingDays'));
  if (durationDays !== null && (durationDays < 1 || durationDays > 25550)) fail(projectId, 'details', 'Duration looks out of range.');
  const clientId = String(formData.get('clientId') ?? '').trim() || null;

  const supabase = await createClient();

  // Keep the legacy client_name in step with the linked client.
  let clientName = project.client_name;
  if (clientId) {
    const { data: c } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle();
    clientName = (c as { name?: string } | null)?.name ?? clientName;
  }

  const { error } = await supabase
    .from('projects')
    .update({
      name,
      description,
      priority,
      construction_type: constructionType,
      client_id: clientId,
      client_name: clientName,
      start_date: startDate,
      duration_working_days: durationDays,
    })
    .eq('id', projectId);
  if (error) fail(projectId, 'details', error.message);
  done(projectId, 'details');
}

/** Commercial: currency, contract value, retention %, payment terms days. */
export async function updateCommercialTerms(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const currency = String(formData.get('currency') ?? 'USD');
  if (!(CURRENCIES as readonly string[]).includes(currency)) fail(projectId, 'commercial', 'Unsupported currency.');

  const contractValue = num(formData.get('contractValue')) ?? 0; // major units
  if (contractValue < 0) fail(projectId, 'commercial', 'Contract value can’t be negative.');
  const retention = num(formData.get('retentionPct'));
  if (retention !== null && (retention < 0 || retention > 100)) fail(projectId, 'commercial', 'Retention must be 0–100%.');
  const retentionMonths = num(formData.get('retentionPeriodMonths'));
  if (retentionMonths !== null && (retentionMonths < 0 || retentionMonths > 120))
    fail(projectId, 'commercial', 'Defects-liability period must be 0–120 months.');
  const paymentDays = num(formData.get('paymentTermsDays'));
  if (paymentDays !== null && (paymentDays < 0 || paymentDays > 365)) fail(projectId, 'commercial', 'Payment terms look out of range.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('projects')
    .update({
      currency,
      contract_value_cents: Math.round(contractValue * 100),
      retention_pct: retention,
      retention_period_months: retentionMonths === null ? null : Math.round(retentionMonths),
      payment_terms_days: paymentDays === null ? null : Math.round(paymentDays),
    })
    .eq('id', projectId);
  if (error) fail(projectId, 'commercial', error.message);
  done(projectId, 'commercial');
}

/** Practical completion: stamps the defects-liability clock and completes the
 *  project (via the mark_practical_completion RPC — PM or org staff only). This is
 *  what makes retention releasable once the agreed period elapses. */
export async function markPracticalCompletion(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_practical_completion', { p_project: projectId });
  if (error) fail(projectId, 'status', error.message);
  await notifyRetentionReleaseScheduled(supabase, projectId);
  done(projectId, 'status');
}

/** Lifecycle status (planning / active / on_hold / completed / archived). */
export async function updateProjectStatus(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const status = String(formData.get('status') ?? '') as ProjectStatus;
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) fail(projectId, 'status', 'Invalid status.');

  const supabase = await createClient();
  const { error } = await supabase.from('projects').update({ status }).eq('id', projectId);
  if (error) fail(projectId, 'status', error.message);
  done(projectId, 'status');
}

/** Site location — completes the "Site location" setup item. Blank clears it. */
export async function updateSiteLocation(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const lat = num(formData.get('latitude'));
  const lng = num(formData.get('longitude'));
  if (lat !== null && (lat < -90 || lat > 90)) fail(projectId, 'status', 'Latitude must be between −90 and 90.');
  if (lng !== null && (lng < -180 || lng > 180)) fail(projectId, 'status', 'Longitude must be between −180 and 180.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('projects')
    .update({ latitude: lat, longitude: lng })
    .eq('id', projectId);
  if (error) fail(projectId, 'status', error.message);
  done(projectId, 'status');
}
