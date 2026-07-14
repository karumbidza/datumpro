import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ContractorDocType, ContractorDocStatus } from '@datumpro/shared/domain';

const MEDIA_BUCKET = 'project-media';

export type ContractorDocumentRow = {
  id: string;
  orgId: string;
  contractorId: string;
  contractorName: string | null;
  docType: ContractorDocType;
  title: string | null;
  fileUrl: string | null;
  fileName: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  status: ContractorDocStatus;
  reviewNote: string | null;
  createdAt: string;
};

async function signedUrlMap(paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(unique, 3600);
  const map = new Map<string, string>();
  for (const item of data ?? []) if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
  return map;
}

type RawDoc = {
  id: string;
  org_id: string;
  contractor_id: string;
  doc_type: ContractorDocType;
  title: string | null;
  storage_path: string;
  file_name: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  status: ContractorDocStatus;
  review_note: string | null;
  created_at: string;
};

const SELECT =
  'id, org_id, contractor_id, doc_type, title, storage_path, file_name, issued_date, expiry_date, status, review_note, created_at';

async function hydrate(rows: RawDoc[], names: Map<string, string>): Promise<ContractorDocumentRow[]> {
  const urls = await signedUrlMap(rows.map((r) => r.storage_path));
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    contractorId: r.contractor_id,
    contractorName: names.get(r.contractor_id) ?? null,
    docType: r.doc_type,
    title: r.title,
    fileUrl: urls.get(r.storage_path) ?? null,
    fileName: r.file_name,
    issuedDate: r.issued_date,
    expiryDate: r.expiry_date,
    status: r.status,
    reviewNote: r.review_note,
    createdAt: r.created_at,
  }));
}

/** The signed-in contractor's own documents (RLS scopes to them). */
export async function listMyDocuments(userId: string): Promise<ContractorDocumentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('contractor_documents')
    .select(SELECT)
    .eq('contractor_id', userId)
    .order('created_at', { ascending: false });
  return hydrate((data ?? []) as RawDoc[], new Map());
}

/** Orgs the user belongs to — the upload target(s) for a compliance doc. */
export async function listMyOrgs(userId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('org_id, organizations(id, name)')
    .eq('user_id', userId)
    .eq('status', 'active');
  const seen = new Map<string, { id: string; name: string }>();
  for (const row of (data ?? []) as { organizations: { id: string; name: string } | { id: string; name: string }[] | null }[]) {
    const o = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (o && !seen.has(o.id)) seen.set(o.id, { id: o.id, name: o.name });
  }
  return [...seen.values()];
}

/** All contractor documents in an org — for the admin review page (RLS scopes to
 *  staff). Under-review first. */
export async function listOrgDocuments(orgId: string): Promise<ContractorDocumentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('contractor_documents')
    .select(SELECT)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as RawDoc[];
  const ids = [...new Set(rows.map((r) => r.contractor_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', ids);
    for (const p of profs ?? []) names.set(p.id, p.display_name || p.email || 'Contractor');
  }
  const hydrated = await hydrate(rows, names);
  const order: Record<ContractorDocStatus, number> = { submitted: 0, rejected: 1, verified: 2 };
  return hydrated.sort((a, b) => order[a.status] - order[b.status]);
}
