'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { createTenderSchema, inviteBidderSchema } from '@datumpro/shared/validation';
import type { FormState } from '@/components/ui/form-error';

/** Resolve the signed-in user + their active org, or bounce. Every mutation
 *  runs under RLS as this user. */
async function requireOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  return { supabase, userId: user.id, orgId: ctx.active.orgId };
}

/** Put a BOQ out to sealed tender. Creates the tender row and redirects
 *  to the tender dashboard for the given BOQ. */
export async function createTender(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireOrg();

  const boqId = String(formData.get('boqId') ?? '');
  const rawCloseAt = String(formData.get('closeAt') ?? '').trim();

  // datetime-local gives "2026-08-10T14:30" — convert to ISO 8601 with timezone, or null.
  let closeAtIso: string | null = null;
  if (rawCloseAt) {
    const d = new Date(rawCloseAt);
    if (!Number.isNaN(d.getTime())) closeAtIso = d.toISOString();
  }

  const parsed = createTenderSchema.safeParse({
    boqId,
    title: String(formData.get('title') ?? ''),
    closeAt: closeAtIso ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  const d = parsed.data;

  const { error } = await supabase.rpc('create_tender', {
    p_boq_id: d.boqId,
    p_title: d.title,
    p_close_at: d.closeAt ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/boq/${boqId}/tender`);
  redirect(`/boq/${boqId}/tender`);
}

/** Invite a company to bid on this tender. userId is optional — set when the
 *  company is an existing org contractor member. Email / link wiring is done
 *  in Task 7 — we store the token here only. */
export async function inviteBidder(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireOrg();

  const tenderId = String(formData.get('tenderId') ?? '');
  const userId = String(formData.get('userId') ?? '').trim() || null;

  const parsed = inviteBidderSchema.safeParse({
    tenderId,
    companyName: String(formData.get('companyName') ?? ''),
    email: String(formData.get('email') ?? ''),
    userId: userId || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  const d = parsed.data;

  const boqId = String(formData.get('boqId') ?? '');

  const { error } = await supabase.rpc('invite_boq_bidder', {
    p_tender_id: d.tenderId,
    p_company_name: d.companyName,
    p_email: d.email,
    p_user_id: d.userId ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/boq/${boqId}/tender`);
  return {};
}

/** Stub action — resend the invite email for a bidder. Email wiring is Task 7.
 *  The button is present here so the UI slot exists and gets wired in the next task. */
export async function resendBidInvite(formData: FormData): Promise<void> {
  await requireOrg();
  // TODO(Task 7): resend bid-invite email using the stored invite_token.
  const boqId = String(formData.get('boqId') ?? '');
  revalidatePath(`/boq/${boqId}/tender`);
}

/** Withdraw a bidder from the tender (soft removal). RLS staff policy allows this. */
export async function revokeBidder(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const bidderId = String(formData.get('bidderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');

  const { error } = await supabase.from('boq_bidders').update({ status: 'withdrawn' }).eq('id', bidderId);
  if (error) throw new Error(error.message);

  revalidatePath(`/boq/${boqId}/tender`);
}

/** Close the tender so no more bids are accepted. Unseal and award are Phase 2. */
export async function closeTender(formData: FormData): Promise<void> {
  const { supabase } = await requireOrg();
  const tenderId = String(formData.get('tenderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');

  const { error } = await supabase.from('boq_tenders').update({ status: 'closed' }).eq('id', tenderId);
  if (error) throw new Error(error.message);

  revalidatePath(`/boq/${boqId}/tender`);
}
