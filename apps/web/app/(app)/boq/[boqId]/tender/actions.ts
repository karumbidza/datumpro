'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { notifyUser } from '@/lib/data/notifications';
import { createTenderSchema, inviteBidderSchema } from '@datumpro/shared/validation';
import type { FormState } from '@/components/ui/form-error';
import { sendEmail } from '@/lib/email/resend';
import { appUrl } from '@/lib/email/templates';
import { tenderInviteEmail } from '@/lib/email/tender-invite';
import { logAudit } from '@/lib/audit';
import { awardWinEmail, awardRegretEmail } from '@/lib/email/tender-award';
import { deliveryAssignedEmail } from '@/lib/email/tender-delivery';

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
      // In-app notification for an invited EXISTING member (a by-email invite of a
      // brand-new contractor has no account to notify — the email is their signal).
      if (d.userId) {
        await notifyUser(supabase, {
          orgId,
          userId: d.userId,
          type: 'tender_invite',
          title: `Invited to price: ${tenderTitle}`,
          body: `${orgName} invited you to submit a bid — open Tenders to price it.`,
          link: `/tender/${token}`,
        });
      }
    } catch (e) {
      if (isRedirect(e)) throw e;
      console.error('[tender] invite email/notify failed:', e);
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
      // Resend ROTATES the link: the RPC issues a fresh token (staff-guarded),
      // so a stale forwarded email goes dead. Falls back to the current token
      // only if rotation is refused (e.g. already submitted — UI hides those).
      const { data: rotated } = await supabase.rpc('rotate_bid_invite_token', {
        p_bidder_id: bidderId,
      });
      const token = (rotated as unknown as string | null) ?? b.invite_token;
      try {
        const [{ data: org }, { data: tender }] = await Promise.all([
          supabase.from('organizations').select('name').eq('id', orgId).single(),
          supabase.from('boq_tenders').select('title').eq('id', b.tender_id).single(),
        ]);
        const orgName = (org as { name?: string } | null)?.name ?? 'DatumPro';
        const tenderTitle = (tender as { title?: string } | null)?.title ?? 'Tender';
        const acceptUrl = `${appUrl()}/tender/${token}`;
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

/** Unseal a tender so staff can read bid prices. RPC enforces the gate
 *  (all bidders submitted or deadline passed) + staff auth. Audit-logged. */
export async function unsealTender(formData: FormData): Promise<void> {
  const { supabase, userId, orgId } = await requireOrg();
  const tenderId = String(formData.get('tenderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const { error } = await supabase.rpc('unseal_tender', { p_tender_id: tenderId });
  if (error) throw new Error(error.message);
  await logAudit({ orgId, actorId: userId, entityType: 'boq_tender', entityId: tenderId, action: 'tender.unsealed' });
  revalidatePath(`/boq/${boqId}/tender`);
}

/** Export an AWARDED tender to a delivery project. The RPC creates/uses a
 *  project, enrols the winner, generates costed tasks, links the tender, and
 *  returns the project id. Then notifies the winning contractor best-effort. */
export async function startDelivery(formData: FormData): Promise<void> {
  const { supabase, orgId } = await requireOrg();
  const tenderId = String(formData.get('tenderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  const mode = String(formData.get('mode') ?? 'new');
  const projectName = String(formData.get('projectName') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const startDate = String(formData.get('startDate') ?? '').trim() || new Date().toISOString().slice(0, 10);

  const { data: result, error } = await supabase.rpc('export_award_to_project', {
    p_tender_id: tenderId,
    p_project_id: mode === 'existing' && projectId ? projectId : null,
    p_new_project_name: mode === 'new' ? projectName : null,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { project_id: string; mode: string; skipped_tasks: string[] };
  const projId = res.project_id;

  // Same program-of-works scheduling as the auto-award path.
  try {
    await supabase.rpc('schedule_boq_tasks', { p_project_id: projId, p_boq_id: boqId, p_start_date: startDate });
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('[tender] start-delivery auto-schedule failed (tasks stand):', e);
  }

  // Best-effort: notify the winning contractor.
  try {
    const [{ data: org }, { data: tender }, { count: taskCount }, { data: proj }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', orgId).single(),
      supabase.from('boq_tenders').select('awarded_bidder_id').eq('id', tenderId).single(),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', projId),
      supabase.from('projects').select('name').eq('id', projId).single(),
    ]);
    const awardedBidderId = (tender as { awarded_bidder_id?: string } | null)?.awarded_bidder_id ?? '';
    const { data: bidder } = await supabase
      .from('boq_bidders').select('contact_email').eq('id', awardedBidderId).single();
    const email = (bidder as { contact_email?: string } | null)?.contact_email;
    if (email) {
      const { subject, html } = deliveryAssignedEmail({
        orgName: (org as { name?: string } | null)?.name ?? 'DatumPro',
        projectName: (proj as { name?: string } | null)?.name ?? 'your project',
        taskCount: taskCount ?? 0,
      });
      await sendEmail({ to: email, subject, html });
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('[tender] delivery email failed:', e);
  }

  revalidatePath(`/boq/${boqId}/tender`);
  redirect(`/projects/${projId}/tasks`);
}

/** Award a bidder. RPC requires the tender be unsealed + the bidder submitted.
 *  Then emails the winner (win) and the other submitted bidders (regret),
 *  best-effort — a mail failure never breaks the award. */
export async function awardTender(formData: FormData): Promise<void> {
  const { supabase, orgId } = await requireOrg();
  const tenderId = String(formData.get('tenderId') ?? '');
  const bidderId = String(formData.get('bidderId') ?? '');
  const boqId = String(formData.get('boqId') ?? '');
  // Optional mobilisation date for the program of works; default = today (win date).
  const startDate = String(formData.get('startDate') ?? '').trim() || new Date().toISOString().slice(0, 10);

  const { error } = await supabase.rpc('award_boq_tender', { p_tender_id: tenderId, p_bidder_id: bidderId });
  if (error) throw new Error(error.message);

  try {
    const [{ data: org }, { data: tender }, { data: bidders }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', orgId).single(),
      supabase.from('boq_tenders').select('title').eq('id', tenderId).single(),
      supabase.from('boq_bidders').select('id, company_name, contact_email').eq('tender_id', tenderId).eq('status', 'submitted'),
    ]);
    const orgName = (org as { name?: string } | null)?.name ?? 'DatumPro';
    const tenderTitle = (tender as { title?: string } | null)?.title ?? 'Tender';
    for (const b of ((bidders ?? []) as { id: string; company_name: string; contact_email: string }[])) {
      const isWinner = b.id === bidderId;
      const { subject, html } = isWinner
        ? awardWinEmail({ orgName, tenderTitle, companyName: b.company_name })
        : awardRegretEmail({ orgName, tenderTitle, companyName: b.company_name });
      await sendEmail({ to: b.contact_email, subject, html });
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    console.error('[tender] award emails failed:', e);
  }

  // Auto-start delivery: create/use the project, generate costed tasks, and enrol
  // the winner — so "awarded" always means the contractor can see the work.
  // Best-effort: a failure (most often the winner has no linked account) must NOT
  // undo the award. The StartDelivery recovery UI stays on the tender page for
  // those cases. redirect() lives OUTSIDE the try so its control-flow throw isn't
  // swallowed here.
  let deliveredProjectId: string | null = null;
  try {
    const { data: exp, error: expErr } = await supabase.rpc('export_award_to_project', {
      p_tender_id: tenderId,
      p_project_id: null,
      p_new_project_name: null,
    });
    if (expErr) {
      console.error('[tender] auto start-delivery skipped (award stands):', expErr.message);
    } else if (exp) {
      deliveredProjectId = (exp as { project_id?: string } | null)?.project_id ?? null;
      if (deliveredProjectId) {
        try {
          const [{ data: org }, { data: tender }, { count: taskCount }, { data: proj }] = await Promise.all([
            supabase.from('organizations').select('name').eq('id', orgId).single(),
            supabase.from('boq_tenders').select('awarded_bidder_id').eq('id', tenderId).single(),
            supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', deliveredProjectId),
            supabase.from('projects').select('name').eq('id', deliveredProjectId).single(),
          ]);
          const awardedBidderId = (tender as { awarded_bidder_id?: string } | null)?.awarded_bidder_id ?? '';
          const { data: bidder } = await supabase
            .from('boq_bidders').select('contact_email').eq('id', awardedBidderId).single();
          const email = (bidder as { contact_email?: string } | null)?.contact_email;
          if (email) {
            const { subject, html } = deliveryAssignedEmail({
              orgName: (org as { name?: string } | null)?.name ?? 'DatumPro',
              projectName: (proj as { name?: string } | null)?.name ?? 'your project',
              taskCount: taskCount ?? 0,
            });
            await sendEmail({ to: email, subject, html });
          }
        } catch (e) {
          console.error('[tender] delivery-assigned email failed:', e);
        }
      }
    }
  } catch (e) {
    console.error('[tender] auto start-delivery threw (award stands):', e);
  }

  // Auto-schedule the generated tasks into a program of works (planned_start/end/due
  // via the forward pass over BOQ durations + dependencies). Best-effort: a schedule
  // failure must not undo the award or the tasks.
  if (deliveredProjectId) {
    try {
      await supabase.rpc('schedule_boq_tasks', {
        p_project_id: deliveredProjectId,
        p_boq_id: boqId,
        p_start_date: startDate,
      });
    } catch (e) {
      console.error('[tender] auto-schedule failed (award + tasks stand):', e);
    }
  }

  revalidatePath(`/boq/${boqId}/tender`);
  if (deliveredProjectId) redirect(`/projects/${deliveredProjectId}/tasks`);
}
