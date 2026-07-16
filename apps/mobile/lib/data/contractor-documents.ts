import { decode } from 'base64-arraybuffer';
import { supabase, currentUser} from '../supabase';
import type { ContractorDocType, ContractorDocStatus } from '@datumpro/shared/domain';

const BUCKET = 'project-media';

export type MyDocument = {
  id: string;
  docType: ContractorDocType;
  title: string | null;
  fileUrl: string | null;
  expiryDate: string | null;
  status: ContractorDocStatus;
  reviewNote: string | null;
};

/** The signed-in contractor's compliance documents (RLS scopes to them). */
export async function listMyDocuments(): Promise<MyDocument[]> {
  const { data } = await supabase
    .from('contractor_documents')
    .select('id, doc_type, title, storage_path, expiry_date, status, review_note')
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as {
    id: string;
    doc_type: ContractorDocType;
    title: string | null;
    storage_path: string;
    expiry_date: string | null;
    status: ContractorDocStatus;
    review_note: string | null;
  }[];
  if (rows.length === 0) return [];
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const s of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id,
    docType: r.doc_type,
    title: r.title,
    fileUrl: urlByPath.get(r.storage_path) ?? null,
    expiryDate: r.expiry_date,
    status: r.status,
    reviewNote: r.review_note,
  }));
}

export async function listMyOrgs(): Promise<{ id: string; name: string }[]> {
  const user = await currentUser();
  if (!user) return [];
  const { data } = await supabase
    .from('org_members')
    .select('organizations(id, name)')
    .eq('user_id', user.id)
    .eq('status', 'active');
  const seen = new Map<string, { id: string; name: string }>();
  for (const row of (data ?? []) as { organizations: { id: string; name: string } | { id: string; name: string }[] | null }[]) {
    const o = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (o && !seen.has(o.id)) seen.set(o.id, { id: o.id, name: o.name });
  }
  return [...seen.values()];
}

/** Upload a photographed document and file it as a compliance record. */
export async function uploadDocument(params: {
  orgId: string;
  docType: ContractorDocType;
  title?: string | null;
  expiryDate?: string | null;
  base64: string;
  ext: string;
  mime: string;
}): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const path = `${params.orgId}/compliance/${unique}.${params.ext}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(params.base64), { contentType: params.mime, upsert: false });
  if (upErr) throw upErr;

  const { error } = await supabase.from('contractor_documents').insert({
    org_id: params.orgId,
    contractor_id: user.id,
    doc_type: params.docType,
    title: params.title ?? null,
    storage_path: path,
    file_name: `${params.docType}.${params.ext}`,
    expiry_date: params.expiryDate || null,
    status: 'submitted',
  });
  if (error) throw error;
}
