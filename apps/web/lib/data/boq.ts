import { createClient } from '@/lib/supabase/server';
import type { BoqItemType, BoqType } from '@datumpro/shared/domain';

// PostgREST returns numeric as string and bigint as number-or-string depending on
// size; coerce everything through Number at the boundary so the app deals in plain
// numbers and never leaks a stringly-typed total into a calculation.
const n = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

export interface BoqListRow {
  id: string;
  name: string;
  clientName: string | null;
  industry: string | null;
  status: string;
  currency: string;
  boqDate: string | null;
  updatedAt: string;
  itemCount: number;
  totalCents: number;
}

/** All bills in the org, newest first — the Estimates index. RLS scopes to the
 *  org; item count and total are rolled up from the nested items. */
export async function listBoqs(orgId: string): Promise<BoqListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boqs')
    .select(
      'id, name, client_name, industry, status, currency, boq_date, updated_at, boq_sections(boq_items(amount_cents))',
    )
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false });

  type Row = {
    id: string;
    name: string;
    client_name: string | null;
    industry: string | null;
    status: string;
    currency: string;
    boq_date: string | null;
    updated_at: string;
    boq_sections: { boq_items: { amount_cents: number | string | null }[] | null }[] | null;
  };

  return ((data ?? []) as Row[]).map((r) => {
    const items = (r.boq_sections ?? []).flatMap((s) => s.boq_items ?? []);
    return {
      id: r.id,
      name: r.name,
      clientName: r.client_name,
      industry: r.industry,
      status: r.status,
      currency: r.currency,
      boqDate: r.boq_date,
      updatedAt: r.updated_at,
      itemCount: items.length,
      totalCents: items.reduce((a, it) => a + n(it.amount_cents), 0),
    };
  });
}

export interface BoqItem {
  id: string;
  description: string;
  uom: string | null;
  qty: number;
  budgetRateCents: number;
  itemType: BoqItemType;
  position: number;
  amountCents: number;
}

export interface BoqSection {
  id: string;
  name: string;
  position: number;
  items: BoqItem[];
}

export interface BoqDetail {
  id: string;
  name: string;
  boqType: BoqType;
  clientName: string | null;
  industry: string | null;
  reference: string | null;
  location: string | null;
  boqDate: string | null;
  currency: string;
  status: string;
  sections: BoqSection[];
}

/** One bill with its sections and priced items, ordered for the builder. Returns
 *  null when the id isn't visible to the caller (RLS) or doesn't exist. */
export async function getBoqDetail(orgId: string, boqId: string): Promise<BoqDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boqs')
    .select(
      'id, name, boq_type, client_name, industry, reference, location, boq_date, currency, status, ' +
        'boq_sections(id, name, position, ' +
        'boq_items(id, description, uom, qty, budget_rate_cents, item_type, position, amount_cents))',
    )
    .eq('id', boqId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!data) return null;

  type ItemRow = {
    id: string;
    description: string;
    uom: string | null;
    qty: number | string | null;
    budget_rate_cents: number | string | null;
    item_type: BoqItemType;
    position: number;
    amount_cents: number | string | null;
  };
  type SectionRow = { id: string; name: string; position: number; boq_items: ItemRow[] | null };
  type BoqRow = {
    id: string;
    name: string;
    boq_type: BoqType;
    client_name: string | null;
    industry: string | null;
    reference: string | null;
    location: string | null;
    boq_date: string | null;
    currency: string;
    status: string;
    boq_sections: SectionRow[] | null;
  };

  // The select is built by concatenation, so supabase-js can't infer the row
  // shape (it widens to a parse-error type); assert through unknown to our type.
  const b = data as unknown as BoqRow;
  const sections: BoqSection[] = (b.boq_sections ?? [])
    .slice()
    .sort((a, c) => a.position - c.position)
    .map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      items: (s.boq_items ?? [])
        .slice()
        .sort((a, c) => a.position - c.position)
        .map((it) => ({
          id: it.id,
          description: it.description,
          uom: it.uom,
          qty: n(it.qty),
          budgetRateCents: n(it.budget_rate_cents),
          itemType: it.item_type,
          position: it.position,
          amountCents: n(it.amount_cents),
        })),
    }));

  return {
    id: b.id,
    name: b.name,
    boqType: b.boq_type,
    clientName: b.client_name,
    industry: b.industry,
    reference: b.reference,
    location: b.location,
    boqDate: b.boq_date,
    currency: b.currency,
    status: b.status,
    sections,
  };
}
