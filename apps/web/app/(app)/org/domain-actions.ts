'use server';

import { promises as dns } from 'node:dns';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isPersonalEmailDomain } from '@datumpro/shared/validation';
import { logAudit } from '@/lib/audit';

const ORG = '/org?tab=domains';

/** Bare-domain sanity: lowercase, no scheme/path, at least one dot. */
function normalizeDomain(raw: string): string | null {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^@/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

export async function addOrgDomain(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const domain = normalizeDomain(String(formData.get('domain') ?? ''));
  if (!orgId) throw new Error('Missing organisation');
  if (!domain) redirect(`${ORG}&derror=${encodeURIComponent('Enter a valid domain, e.g. acme.com')}`);
  if (isPersonalEmailDomain(domain)) {
    redirect(`${ORG}&derror=${encodeURIComponent('Personal email domains (gmail, outlook, …) can’t be claimed.')}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const token = `datumpro-verify=${crypto.randomUUID().replace(/-/g, '')}`;
  const { error } = await supabase
    .from('org_domains')
    .insert({ org_id: orgId, domain, verification_token: token, created_by: user.id });
  if (error) {
    redirect(`${ORG}&derror=${encodeURIComponent(error.code === '23505' ? 'That domain is already added.' : error.message)}`);
  }
  await logAudit({ orgId, actorId: user.id, entityType: 'org_domain', entityId: null, action: 'domain.added', after: { domain } });
  revalidatePath(ORG);
  redirect(ORG);
}

export async function verifyOrgDomain(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!orgId || !id) throw new Error('Missing domain');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: row } = await supabase
    .from('org_domains')
    .select('domain, verification_token')
    .eq('id', id)
    .single();
  const rec = row as { domain: string; verification_token: string } | null;
  if (!rec) redirect(`${ORG}&derror=${encodeURIComponent('Domain not found.')}`);

  // Look up the domain's TXT records and match the expected token. TXT records can
  // be chunked, so join each record's parts before comparing.
  let found = false;
  try {
    const records = await dns.resolveTxt(rec.domain);
    found = records.some((parts) => parts.join('').trim() === rec.verification_token);
  } catch {
    found = false; // NXDOMAIN / no TXT — treated as not verified
  }
  if (!found) {
    redirect(`${ORG}&derror=${encodeURIComponent(`No matching TXT record yet. Add a TXT record with value "${rec.verification_token}" and try again (DNS can take a few minutes).`)}`);
  }

  const { error } = await supabase.from('org_domains').update({ verified_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    redirect(`${ORG}&derror=${encodeURIComponent(error.code === '23505' ? 'That domain is already verified by another organisation.' : error.message)}`);
  }
  await logAudit({ orgId, actorId: user.id, entityType: 'org_domain', entityId: id, action: 'domain.verified', after: { domain: rec.domain } });
  revalidatePath(ORG);
  redirect(`${ORG}&dok=1`);
}

export async function removeOrgDomain(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!orgId || !id) throw new Error('Missing domain');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { error } = await supabase.from('org_domains').delete().eq('id', id);
  if (error) redirect(`${ORG}&derror=${encodeURIComponent(error.message)}`);
  await logAudit({ orgId, actorId: user.id, entityType: 'org_domain', entityId: id, action: 'domain.removed' });
  revalidatePath(ORG);
  redirect(ORG);
}
