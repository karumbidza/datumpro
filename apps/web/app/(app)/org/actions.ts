'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

/** Rename the organisation. RLS restricts organizations UPDATE to owner/admin,
 *  so a non-admin's write is rejected at the database regardless of the UI. */
export async function renameOrganization(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!orgId) throw new Error('Missing organisation');
  if (!name) throw new Error('Organisation name is required');
  if (name.length > 120) throw new Error('That name is too long');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.from('organizations').update({ name }).eq('id', orgId);
  if (error) throw new Error(error.message);

  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'organization.renamed', after: { name } });

  // The name shows in the sidebar switcher too — refresh the whole shell.
  revalidatePath('/', 'layout');
}

/** Update the organisation's company profile (legal name, sector, country,
 *  registration number). These are captured at signup; this lets an admin edit
 *  them afterwards. RLS restricts organizations UPDATE to owner/admin. */
export async function updateCompanyProfile(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (!orgId) throw new Error('Missing organisation');

  const clip = (v: FormDataEntryValue | null, max: number) => {
    const s = String(v ?? '').trim();
    if (s.length > max) throw new Error('That value is too long');
    return s === '' ? null : s;
  };
  const patch = {
    legal_name: clip(formData.get('legalName'), 200),
    sector: clip(formData.get('sector'), 120),
    country: clip(formData.get('country'), 120),
    registration_number: clip(formData.get('registrationNumber'), 120),
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.from('organizations').update(patch).eq('id', orgId);
  if (error) throw new Error(error.message);

  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'organization.profile_updated', after: patch });
  revalidatePath('/org');
}

const LOGO_BUCKET = 'org-logos';
const LOGO_TYPES = ['image/webp', 'image/jpeg', 'image/png'];

/** Upload (or replace) the organisation's logo. Stored at {orgId}/logo in the
 *  public org-logos bucket; storage RLS restricts the write to org admins. */
export async function uploadOrgLogo(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const file = formData.get('logo');
  if (!orgId) throw new Error('Missing organisation');
  if (!(file instanceof File) || file.size === 0) throw new Error('Choose an image to upload');
  if (!LOGO_TYPES.includes(file.type)) throw new Error('Logo must be a PNG, JPEG or WebP image');
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be under 2 MB');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const path = `${orgId}/logo`;
  const { error: upErr } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw new Error(upErr.message);

  const { error } = await supabase
    .from('organizations')
    .update({ logo_path: path, logo_updated_at: new Date().toISOString() })
    .eq('id', orgId);
  if (error) throw new Error(error.message);

  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'organization.logo_updated', after: { logo_path: path } });
  revalidatePath('/', 'layout'); // the sidebar switcher shows the logo
  revalidatePath('/org');
}

/** Remove the organisation's logo (storage object + stored path). */
export async function removeOrgLogo(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (!orgId) throw new Error('Missing organisation');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  await supabase.storage.from(LOGO_BUCKET).remove([`${orgId}/logo`]);
  const { error } = await supabase
    .from('organizations')
    .update({ logo_path: null, logo_updated_at: null })
    .eq('id', orgId);
  if (error) throw new Error(error.message);

  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'organization.logo_removed' });
  revalidatePath('/', 'layout');
  revalidatePath('/org');
}

const SECOND_APPROVERS = ['admin', 'finance', 'pm', 'viewer', 'none'];

/** Set the org-wide second approver (or 'none' for a single PM-only approval).
 *  The RPC is SECURITY DEFINER and re-checks org-admin, so a non-admin's call is
 *  rejected at the database. Applies uniformly across every approvable type. */
export async function setApprovalPolicy(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const second = String(formData.get('secondApprover') ?? '');
  if (!orgId) throw new Error('Missing organisation');
  if (!SECOND_APPROVERS.includes(second)) throw new Error('Invalid approver');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.rpc('set_org_approval_policy', {
    p_org_id: orgId,
    p_second_role: second,
  });
  if (error) throw new Error(error.message);
  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'approval_policy.set', after: { secondApprover: second } });
  revalidatePath('/org');
}

const MATRIX_ENTITY_TYPES = ['task_plan', 'task_variation', 'extension', 'payment', 'request'] as const;

/** Set the per-entity-type approval matrix (role chains + thresholds). Step 1 is
 *  always PM. RPC is SECURITY DEFINER and re-checks org-admin. */
export async function setApprovalMatrix(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (!orgId) throw new Error('Missing organisation');

  const rows = MATRIX_ENTITY_TYPES.map((et) => {
    const extra_roles = [String(formData.get(`${et}_step2`) ?? 'none'), String(formData.get(`${et}_step3`) ?? 'none')]
      .filter((r) => r && r !== 'none');
    const dollars = Number(formData.get(`${et}_threshold`) ?? 0);
    const min_amount_cents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
    return { entity_type: et, extra_roles, min_amount_cents };
  });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.rpc('set_org_approval_matrix', { p_org_id: orgId, p_rows: rows });
  if (error) throw new Error(error.message);

  await logAudit({ orgId, actorId: user.id, entityType: 'organization', entityId: orgId, action: 'approval_matrix.set', after: { rows } });
  revalidatePath('/org');
}
