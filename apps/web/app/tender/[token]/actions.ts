'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { saveBidRateSchema } from '@datumpro/shared/validation';

/** Resolve the signed-in user's bidder row by invite token.
 *  NEVER accepts a bidder id from the client — always derived server-side.
 *  RLS policy `boq_bidders_self_read` scopes the query to the caller's own row. */
async function resolveBidder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  token: string,
): Promise<{ bidderId: string; orgId: string } | null> {
  const { data, error } = await supabase
    .from('boq_bidders')
    .select('id, org_id')
    .eq('invite_token', token)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as { id: string; org_id: string };
  return { bidderId: row.id, orgId: row.org_id };
}

/** Upsert a single bid-rate line. Called on every cell blur.
 *  The bidder id is NEVER trusted from the client — always derived from the
 *  server-side token lookup so RLS remains the only identity boundary. */
export async function saveBidRate(input: unknown): Promise<{ error?: string }> {
  const parsed = saveBidRateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const { token, boqItemId, rateCents, noBid, note } = parsed.data;

  const supabase = await createClient();
  const bidder = await resolveBidder(supabase, token);
  if (!bidder) return { error: 'Bidder not found or not authorised.' };

  const { error } = await supabase.from('boq_bid_items').upsert(
    {
      org_id: bidder.orgId,
      bidder_id: bidder.bidderId,
      boq_item_id: boqItemId,
      rate_cents: rateCents,
      no_bid: noBid ?? false,
      note: note ?? null,
    },
    { onConflict: 'bidder_id,boq_item_id' },
  );

  if (error) return { error: error.message };

  revalidatePath(`/tender/${token}`);
  return {};
}

/** Submit the sealed bid. Calls the `submit_boq_bid` RPC which enforces:
 *  - deadline not passed
 *  - bid not already submitted
 *  - caller owns the bidder row
 *  On success the page revalidates to read-only view. */
export async function submitBid(formData: FormData): Promise<{ error?: string }> {
  const token = String(formData.get('token') ?? '');
  if (!token) return { error: 'Missing token.' };

  const supabase = await createClient();
  const bidder = await resolveBidder(supabase, token);
  if (!bidder) return { error: 'Bidder not found or not authorised.' };

  const { error } = await supabase.rpc('submit_boq_bid', {
    p_bidder_id: bidder.bidderId,
  });

  if (error) {
    // Surface RPC domain errors as friendly messages.
    const msg = error.message ?? '';
    if (/not your bid/i.test(msg)) return { error: 'You are not authorised to submit this bid.' };
    if (/tender closed/i.test(msg)) return { error: 'This tender has closed. Bids can no longer be submitted.' };
    if (/already submitted/i.test(msg)) return { error: 'Your bid has already been submitted.' };
    return { error: msg };
  }

  revalidatePath(`/tender/${token}`);
  return {};
}
