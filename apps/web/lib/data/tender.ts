import { createClient } from '@/lib/supabase/server';
import type { BidderStatus, TenderStatus } from '@datumpro/shared/domain';

// PostgREST returns numeric as string; coerce everything through Number at the
// boundary so the app always deals in plain numbers.
const n = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BidderRow {
  id: string;
  companyName: string;
  contactEmail: string;
  status: BidderStatus;
  submittedAt: string | null;
  userId: string | null;
}

export interface OwnerTenderView {
  id: string;
  title: string;
  status: TenderStatus;
  closeAt: string | null;
  unsealedAt: string | null;
  bidders: BidderRow[];
}

export interface BidLine {
  itemId: string;
  description: string;
  uom: string | null;
  qty: number;
}

export interface BidSection {
  sectionId: string;
  name: string;
  items: BidLine[];
}

/** myRates keyed by boq_item_id */
export interface BidWorkspace {
  tenderId: string;
  title: string;
  status: TenderStatus;
  closeAt: string | null;
  bidderId: string;
  bidderStatus: BidderStatus;
  companyName: string;
  sections: BidSection[];
  myRates: Record<string, { rateCents: number; noBid: boolean; note: string | null }>;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/** Returns the latest tender for a given BOQ (scoped to org), with its invited
 *  bidder list. Returns null when no tender exists or RLS blocks access. */
export async function getTenderForOwner(
  orgId: string,
  boqId: string,
): Promise<OwnerTenderView | null> {
  const supabase = await createClient();

  const { data: tender } = await supabase
    .from('boq_tenders')
    .select('id, title, status, close_at, unsealed_at')
    .eq('org_id', orgId)
    .eq('boq_id', boqId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tender) return null;

  type TenderRow = {
    id: string;
    title: string;
    status: TenderStatus;
    close_at: string | null;
    unsealed_at: string | null;
  };

  const t = tender as unknown as TenderRow;

  const { data: bidders } = await supabase
    .from('boq_bidders')
    .select('id, company_name, contact_email, status, submitted_at, user_id')
    .eq('tender_id', t.id)
    .order('invited_at', { ascending: true });

  type BidderDbRow = {
    id: string;
    company_name: string;
    contact_email: string;
    status: BidderStatus;
    submitted_at: string | null;
    user_id: string | null;
  };

  const mappedBidders: BidderRow[] = ((bidders ?? []) as unknown as BidderDbRow[]).map((b) => ({
    id: b.id,
    companyName: b.company_name,
    contactEmail: b.contact_email,
    status: b.status,
    submittedAt: b.submitted_at,
    userId: b.user_id,
  }));

  return {
    id: t.id,
    title: t.title,
    status: t.status,
    closeAt: t.close_at,
    unsealedAt: t.unsealed_at,
    bidders: mappedBidders,
  };
}

/** Returns the full bid workspace for a bidder identified by their invite token.
 *  Includes the bill-of-quantities line items (no budget rates) and any rates
 *  the bidder has already saved. Returns null when the token is invalid or RLS
 *  blocks access. */
export async function getBidWorkspace(token: string): Promise<BidWorkspace | null> {
  const supabase = await createClient();

  // 1. Resolve bidder by invite token (RLS boq_bidders_self_read scopes this).
  const { data: bidder } = await supabase
    .from('boq_bidders')
    .select('id, tender_id, company_name, status')
    .eq('invite_token', token)
    .maybeSingle();

  if (!bidder) return null;

  type BidderSelf = {
    id: string;
    tender_id: string;
    company_name: string;
    status: BidderStatus;
  };

  const b = bidder as unknown as BidderSelf;

  // 2. Load the tender header.
  const { data: tender } = await supabase
    .from('boq_tenders')
    .select('id, title, status, close_at')
    .eq('id', b.tender_id)
    .maybeSingle();

  if (!tender) return null;

  type TenderHeader = {
    id: string;
    title: string;
    status: TenderStatus;
    close_at: string | null;
  };

  const t = tender as unknown as TenderHeader;

  // 3. Load bill lines via SECURITY DEFINER function (no budget rate exposed).
  const { data: lines } = await supabase.rpc('tender_bill_lines', {
    p_tender_id: b.tender_id,
  });

  type BillLine = {
    section_id: string;
    section_name: string;
    section_position: number;
    item_id: string;
    description: string;
    uom: string | null;
    qty: number | string | null;
    item_position: number;
  };

  // Group into sections ordered by section_position, items by item_position.
  const sectionMap = new Map<string, { meta: { name: string; position: number }; items: BillLine[] }>();

  for (const row of (lines ?? []) as unknown as BillLine[]) {
    if (!sectionMap.has(row.section_id)) {
      sectionMap.set(row.section_id, {
        meta: { name: row.section_name, position: row.section_position },
        items: [],
      });
    }
    sectionMap.get(row.section_id)!.items.push(row);
  }

  const sections: BidSection[] = Array.from(sectionMap.entries())
    .sort(([, a], [, b]) => a.meta.position - b.meta.position)
    .map(([sectionId, { meta, items }]) => ({
      sectionId,
      name: meta.name,
      items: items
        .slice()
        .sort((a, c) => a.item_position - c.item_position)
        .map((row) => ({
          itemId: row.item_id,
          description: row.description,
          uom: row.uom,
          qty: n(row.qty),
        })),
    }));

  // 4. Load this bidder's existing rates (RLS scopes to own rows).
  const { data: rateRows } = await supabase
    .from('boq_bid_items')
    .select('boq_item_id, rate_cents, no_bid, note')
    .eq('bidder_id', b.id);

  type RateRow = {
    boq_item_id: string;
    rate_cents: number | string | null;
    no_bid: boolean | null;
    note: string | null;
  };

  const myRates: Record<string, { rateCents: number; noBid: boolean; note: string | null }> = {};
  for (const r of (rateRows ?? []) as unknown as RateRow[]) {
    myRates[r.boq_item_id] = {
      rateCents: n(r.rate_cents),
      noBid: !!r.no_bid,
      note: r.note,
    };
  }

  return {
    tenderId: t.id,
    title: t.title,
    status: t.status,
    closeAt: t.close_at,
    bidderId: b.id,
    bidderStatus: b.status,
    companyName: b.company_name,
    sections,
    myRates,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: post-unseal comparison types
// ---------------------------------------------------------------------------

export interface CompareLine {
  itemId: string;
  description: string;
  uom: string | null;
  qty: number;
  budgetRateCents: number;
  budgetAmountCents: number;
}
export interface CompareSection { sectionId: string; name: string; items: CompareLine[]; }
export interface CompareBidder {
  bidderId: string;
  companyName: string;
  totalCents: number;
  varianceCents: number;
  variancePct: number;
  rank: number;
  pricedLines: number;
  totalLines: number;
  coveragePct: number;
  isComplete: boolean;
  rates: Record<string, { rateCents: number; amountCents: number; noBid: boolean }>;
}
export interface TenderComparison {
  tenderId: string;
  title: string;
  status: TenderStatus;
  awardedBidderId: string | null;
  budgetTotalCents: number;
  sections: CompareSection[];
  bidders: CompareBidder[];
  currency: string;
}

// ---------------------------------------------------------------------------
// Phase 2: getTenderComparison — ranked bidder totals, variance vs budget, per-line rates
// ---------------------------------------------------------------------------

/** Returns a full comparison matrix for a sealed tender (post-unseal only).
 *  Returns null when no tender exists, the tender has not been unsealed yet,
 *  or RLS blocks access. */
export async function getTenderComparison(
  orgId: string,
  boqId: string,
): Promise<TenderComparison | null> {
  const supabase = await createClient();

  // 1. Load the latest tender for the boq.
  const { data: tenderRaw } = await supabase
    .from('boq_tenders')
    .select('id, title, status, unsealed_at, awarded_bidder_id, boq_id')
    .eq('org_id', orgId)
    .eq('boq_id', boqId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  type TenderRow = {
    id: string;
    title: string;
    status: TenderStatus;
    unsealed_at: string | null;
    awarded_bidder_id: string | null;
    boq_id: string;
  };

  if (!tenderRaw) return null;
  const tender = tenderRaw as unknown as TenderRow;
  if (!tender.unsealed_at) return null;

  // 2. Load the bill (sections + items with budget figures).
  const { data: boqRaw } = await supabase
    .from('boqs')
    .select(
      'id, currency, ' +
        'boq_sections(id, name, position, ' +
        'boq_items(id, description, uom, qty, budget_rate_cents, position))',
    )
    .eq('id', tender.boq_id)
    .eq('org_id', orgId)
    .maybeSingle();

  type BillItemRow = {
    id: string;
    description: string;
    uom: string | null;
    qty: number | string | null;
    budget_rate_cents: number | string | null;
    position: number;
  };
  type BillSectionRow = { id: string; name: string; position: number; boq_items: BillItemRow[] | null };
  type BoqBillRow = {
    id: string;
    currency: string | null;
    boq_sections: BillSectionRow[] | null;
  };

  if (!boqRaw) return null;
  const boq = boqRaw as unknown as BoqBillRow;
  const currency = boq.currency ?? 'USD';

  // Build sections, compute budget amounts, collect flat item qty map.
  const qtyMap = new Map<string, number>();
  let budgetTotalCents = 0;

  const sections: CompareSection[] = (boq.boq_sections ?? [])
    .slice()
    .sort((a, c) => a.position - c.position)
    .map((s) => ({
      sectionId: s.id,
      name: s.name,
      items: (s.boq_items ?? [])
        .slice()
        .sort((a, c) => a.position - c.position)
        .map((it) => {
          const qty = n(it.qty);
          const budgetRateCents = n(it.budget_rate_cents);
          const budgetAmountCents = Math.round(qty * budgetRateCents);
          qtyMap.set(it.id, qty);
          budgetTotalCents += budgetAmountCents;
          return { itemId: it.id, description: it.description, uom: it.uom, qty, budgetRateCents, budgetAmountCents };
        }),
    }));

  // 3. Load submitted bidders.
  const { data: biddersRaw } = await supabase
    .from('boq_bidders')
    .select('id, company_name')
    .eq('tender_id', tender.id)
    .eq('status', 'submitted');

  type BidderRow2 = { id: string; company_name: string };
  const biddersData = (biddersRaw ?? []) as unknown as BidderRow2[];
  const bidderIds = biddersData.map((b) => b.id);

  // 4. Load bid items for all submitted bidders.
  type BidItemRow = {
    bidder_id: string;
    boq_item_id: string;
    rate_cents: number | string | null;
    no_bid: boolean | null;
  };

  let bidItemRows: BidItemRow[] = [];
  if (bidderIds.length > 0) {
    const { data: bidItemsRaw } = await supabase
      .from('boq_bid_items')
      .select('bidder_id, boq_item_id, rate_cents, no_bid')
      .in('bidder_id', bidderIds);
    bidItemRows = (bidItemsRaw ?? []) as unknown as BidItemRow[];
  }

  // Group bid items by bidder_id.
  const bidItemsByBidder = new Map<string, BidItemRow[]>();
  for (const row of bidItemRows) {
    const existing = bidItemsByBidder.get(row.bidder_id) ?? [];
    existing.push(row);
    bidItemsByBidder.set(row.bidder_id, existing);
  }

  // 5. Build CompareBidder entries (unsorted — rank assigned after sort).
  const totalLines = qtyMap.size;
  const unsortedBidders: Omit<CompareBidder, 'rank'>[] = biddersData.map((bd) => {
    const rows = bidItemsByBidder.get(bd.id) ?? [];
    const rates: CompareBidder['rates'] = {};
    let totalCents = 0;
    let pricedLines = 0;
    for (const row of rows) {
      const noBid = !!row.no_bid;
      const rateCents = n(row.rate_cents);
      const qty = qtyMap.get(row.boq_item_id) ?? 0;
      const amountCents = noBid ? 0 : Math.round(qty * rateCents);
      rates[row.boq_item_id] = { rateCents, amountCents, noBid };
      totalCents += amountCents;
      if (!noBid && row.rate_cents != null) pricedLines += 1;
    }
    const varianceCents = totalCents - budgetTotalCents;
    const variancePct = budgetTotalCents > 0 ? varianceCents / budgetTotalCents : 0;
    const coveragePct = totalLines > 0 ? pricedLines / totalLines : 1;
    const isComplete = pricedLines === totalLines;
    return {
      bidderId: bd.id,
      companyName: bd.company_name,
      totalCents,
      varianceCents,
      variancePct,
      pricedLines,
      totalLines,
      coveragePct,
      isComplete,
      rates,
    };
  });

  // 6. Sort ascending by totalCents, assign rank.
  const bidders: CompareBidder[] = unsortedBidders
    .slice()
    .sort((a, c) => a.totalCents - c.totalCents)
    .map((bd, idx) => ({ ...bd, rank: idx + 1 }));

  // 7. Return.
  return {
    tenderId: tender.id,
    title: tender.title,
    status: tender.status,
    awardedBidderId: tender.awarded_bidder_id,
    budgetTotalCents,
    sections,
    bidders,
    currency,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: getTenderOwnerExtras — RPC-based eligibility check
// ---------------------------------------------------------------------------

export async function getTenderOwnerExtras(
  tenderId: string,
): Promise<{ unsealEligible: boolean }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('tender_unseal_eligible', { p_tender_id: tenderId });
  return { unsealEligible: !!data };
}

// ---------------------------------------------------------------------------
// Contractor portal: the caller's own tender invites
// ---------------------------------------------------------------------------

export interface MyTenderInvite {
  bidderId: string;
  inviteToken: string;
  bidderStatus: 'invited' | 'viewing' | 'submitted' | 'withdrawn';
  tenderId: string;
  title: string;
  closeAt: string | null;
  tenderStatus: TenderStatus;
  awardedToMe: boolean;
  tenderAwarded: boolean;
}

export async function listMyTenderInvites(userId: string): Promise<MyTenderInvite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boq_bidders')
    .select(
      'id, invite_token, status, tender_id, ' +
        'boq_tenders(id, title, close_at, status, awarded_bidder_id)',
    )
    .eq('user_id', userId)
    .neq('status', 'withdrawn');

  type Row = {
    id: string;
    invite_token: string;
    status: MyTenderInvite['bidderStatus'];
    tender_id: string;
    boq_tenders:
      | { id: string; title: string; close_at: string | null; status: TenderStatus; awarded_bidder_id: string | null }
      | { id: string; title: string; close_at: string | null; status: TenderStatus; awarded_bidder_id: string | null }[]
      | null;
  };

  return ((data ?? []) as unknown as Row[])
    .map((r) => {
      const t = Array.isArray(r.boq_tenders) ? r.boq_tenders[0] : r.boq_tenders;
      if (!t) return null;
      return {
        bidderId: r.id,
        inviteToken: r.invite_token,
        bidderStatus: r.status,
        tenderId: t.id,
        title: t.title,
        closeAt: t.close_at,
        tenderStatus: t.status,
        awardedToMe: t.awarded_bidder_id === r.id,
        tenderAwarded: t.status === 'awarded',
      } as MyTenderInvite;
    })
    .filter((x): x is MyTenderInvite => x !== null);
}
