'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { createTenderSchema, inviteBidderSchema } from '@datumpro/shared/validation';
import type { FormState } from '@/components/ui/form-error';
import { sendEmail } from '@/lib/email/resend';
import { appUrl } from '@/lib/email/templates';
import { tenderInviteEmail } from '@/lib/email/tender-invite';

/** Next's redirect() signals control flow by throwing a special error — never
 *  swallow it inside a best-effort catch. */
function isRedirect(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'digest' in e &&
    String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')
  );
}

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
 *  company is an existing org contractor member. Emails a unique sealed-bid
 *  link to the contact best-effort (mail failure never breaks the invite). */
export async function inviteBidder(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, orgId } = await requireOrg();

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

  const { data: rpcData, error } = await supabase.rpc('invite_boq_bidder', {
    p_tender_id: d.tenderId,
    p_company_name: d.companyName,
    p_email: d.email,
    p_user_id: d.userId ?? null,
  });
  if (error) return { error: error.message };

  // The RPC returns a table (bidder_id, token) — Supabase surfaces it as an array.
  const token: string | undefined =
    Array.isArray(rpcData) ? rpcData[0]?.token : (rpcData as { token?: string } | null)?.token;

  // Best-effort email — the bidder row + token already exist; a mail hiccup must
  // never surface as a FormState error.
  if (token) {
    try {
      const [{ data: org }, { data: tender }] = await Promise.all([
        supabase.from('organizations').select('name').eq('id', orgId).single(),
        supabase.from('boq_tenders').select('title').eq('id', d.tenderId).single(),
      ]);
      const orgName = (org as { name?: string } | null)?.name ?? 'DatumPro';
      const tenderTitle = (tender as { title?: string } | null)?.title ?? 'Tender';
      const acceptUrl = `${appUrl()}/tender/${token}`;
      const { subject, html } = tenderInviteEmail({
        orgName,
        tenderTitle,
        companyName: d.companyName,
        acceptUrl,
      });
      await sendEmail({ to: d.email, subject, html });
    } catch (e) {
      if (isRedirect(e)) throw e;
      console.error('[tender] invite email failed:', e);
    }
  }

  revalidatePath(`/boq/${boqId}/tender`);
  return {};
}

/** Resend the sealed-bid invite email for an existing bidder, reusing their
 *  stored invite_token. Email is best-effort; errors are logged not thrown. */
export async function resendBidInvite(formData: FormData): Promise<void> {
  const { supabase, orgId } = await requireOrg();

  const bidderId = String(formData.get('bidderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');

  if (bidderId) {
    const { data: bidder } = await supabase
      .from('boq_bidders')
      .select('company_name, contact_email, invite_token, tender_id, status')
      .eq('id', bidderId)
      .maybeSingle();

    const b = bidder as {
      company_name: string;
      contact_email: string;
      invite_token: string;
      tender_id: string;
      status: string;
    } | null;

    if (b && b.status !== 'withdrawn' && b.invite_token) {
      try {
        const [{ data: org }, { data: tender }] = await Promise.all([
          supabase.from('organizations').select('name').eq('id', orgId).single(),
          supabase.from('boq_tenders').select('title').eq('id', b.tender_id).single(),
        ]);
        const orgName = (org as { name?: string } | null)?.name ?? 'DatumPro';
        const tenderTitle = (tender as { title?: string } | null)?.title ?? 'Tender';
        const acceptUrl = `${appUrl()}/tender/${b.invite_token}`;
        const { subject, html } = tenderInviteEmail({
          orgName,
          tenderTitle,
          companyName: b.company_name,
          acceptUrl,
        });
        await sendEmail({ to: b.contact_email, subject, html });
      } catch (e) {
        if (isRedirect(e)) throw e;
        console.error('[tender] resend invite email failed:', e);
      }
    }
  }

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
