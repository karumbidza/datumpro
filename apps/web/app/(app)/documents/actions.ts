'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { CONTRACTOR_DOC_TYPES, type ContractorDocType } from '@datumpro/shared/domain';

type Result = { ok: boolean; error?: string };

/** Contractor files a compliance document (already uploaded to Storage). */
export async function uploadContractorDocument(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const orgId = String(formData.get('orgId') ?? '');
  const docType = String(formData.get('docType') ?? 'other') as ContractorDocType;
  const storagePath = String(formData.get('storagePath') ?? '');
  if (!orgId || !storagePath || !CONTRACTOR_DOC_TYPES.includes(docType)) {
    return { ok: false, error: 'Missing document details.' };
  }

  const { error } = await supabase.from('contractor_documents').insert({
    org_id: orgId,
    contractor_id: user.id,
    doc_type: docType,
    title: (formData.get('title') as string) || null,
    storage_path: storagePath,
    file_name: (formData.get('fileName') as string) || null,
    issued_date: (formData.get('issuedDate') as string) || null,
    expiry_date: (formData.get('expiryDate') as string) || null,
    status: 'submitted',
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/payments');
  return { ok: true };
}

async function review(id: string, patch: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const { error } = await supabase
    .from('contractor_documents')
    .update({ ...patch, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/org/documents');
  return { ok: true };
}

export async function verifyContractorDocument(formData: FormData): Promise<Result> {
  return review(String(formData.get('id') ?? ''), { status: 'verified', review_note: null });
}

export async function rejectContractorDocument(formData: FormData): Promise<Result> {
  return review(String(formData.get('id') ?? ''), {
    status: 'rejected',
    review_note: (formData.get('reviewNote') as string) || null,
  });
}
