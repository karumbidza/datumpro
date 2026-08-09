'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { createBoqSchema } from '@datumpro/shared/validation';
import { BOQ_ITEM_TYPES, BOQ_STATUSES, type BoqItemType, type BoqStatus } from '@datumpro/shared/domain';
import type { FormState } from '@/components/ui/form-error';

/** Resolve the signed-in user + their active org, or bounce. Every mutation runs
 *  under RLS as this user; writes additionally require org admin/PM (enforced by
 *  the boqs/boq_sections/boq_items write policies). */
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

type Ok<T> = T & { error?: undefined };
type Err = { error: string };

/** Create a bill and open its builder. */
export async function createBoq(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId, orgId } = await requireOrg();

  const parsed = createBoqSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    boqType: String(formData.get('boqType') ?? ''),
    clientName: String(formData.get('clientName') ?? ''),
    industry: (formData.get('industry') as string) || undefined,
    reference: String(formData.get('reference') ?? ''),
    location: String(formData.get('location') ?? ''),
    boqDate: String(formData.get('boqDate') ?? ''),
    currency: String(formData.get('currency') ?? 'USD'),
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  const d = parsed.data;

  const { data, error } = await supabase
    .from('boqs')
    .insert({
      org_id: orgId,
      name: d.name,
      boq_type: d.boqType,
      client_name: d.clientName || null,
      industry: d.industry ?? null,
      reference: d.reference || null,
      location: d.location || null,
      boq_date: d.boqDate || null,
      currency: d.currency,
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };

  revalidatePath('/boq');
  redirect(`/boq/${(data as { id: string }).id}`);
}

async function touchBoq(supabase: Awaited<ReturnType<typeof createClient>>, boqId: string) {
  await supabase.from('boqs').update({ updated_at: new Date().toISOString() }).eq('id', boqId);
}

export async function addSection(boqId: string): Promise<Ok<{ id: string }> | Err> {
  const { supabase, orgId } = await requireOrg();
  const { data: last } = await supabase
    .from('boq_sections')
    .select('position')
    .eq('boq_id', boqId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from('boq_sections')
    .insert({ org_id: orgId, boq_id: boqId, name: 'Untitled section', position })
    .select('id')
    .single();
  if (error) return { error: error.message };
  await touchBoq(supabase, boqId);
  revalidatePath(`/boq/${boqId}`);
  return { id: (data as { id: string }).id };
}

export async function renameSection(boqId: string, sectionId: string, name: string): Promise<Err | void> {
  const { supabase } = await requireOrg();
  const { error } = await supabase
    .from('boq_sections')
    .update({ name: name.slice(0, 200) })
    .eq('id', sectionId);
  if (error) return { error: error.message };
  await touchBoq(supabase, boqId);
  revalidatePath(`/boq/${boqId}`);
}

export async function deleteSection(boqId: string, sectionId: string): Promise<Err | void> {
  const { supabase } = await requireOrg();
  const { error } = await supabase.from('boq_sections').delete().eq('id', sectionId);
  if (error) return { error: error.message };
  await touchBoq(supabase, boqId);
  revalidatePath(`/boq/${boqId}`);
}

export async function addItem(boqId: string, sectionId: string): Promise<Ok<{ id: string }> | Err> {
  const { supabase, orgId } = await requireOrg();
  const { data: last } = await supabase
    .from('boq_items')
    .select('position')
    .eq('section_id', sectionId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from('boq_items')
    .insert({ org_id: orgId, section_id: sectionId, description: '', qty: 0, budget_rate_cents: 0, position })
    .select('id')
    .single();
  if (error) return { error: error.message };
  await touchBoq(supabase, boqId);
  revalidatePath(`/boq/${boqId}`);
  return { id: (data as { id: string }).id };
}

export interface ItemPatch {
  description?: string;
  uom?: string | null;
  qty?: number;
  budgetRateCents?: number;
  itemType?: BoqItemType;
}

export async function updateItem(boqId: string, itemId: string, patch: ItemPatch): Promise<Err | void> {
  const { supabase } = await requireOrg();

  const row: Record<string, unknown> = {};
  if (patch.description !== undefined) row.description = patch.description.slice(0, 500);
  // Units are free text (validated softly in the UI); store trimmed, or null.
  if (patch.uom !== undefined) row.uom = patch.uom ? patch.uom.trim().slice(0, 24) || null : null;
  if (patch.qty !== undefined) row.qty = Number.isFinite(patch.qty) ? Math.max(0, patch.qty) : 0;
  if (patch.budgetRateCents !== undefined)
    row.budget_rate_cents = Number.isFinite(patch.budgetRateCents) ? Math.max(0, Math.round(patch.budgetRateCents)) : 0;
  if (patch.itemType !== undefined) {
    if (!BOQ_ITEM_TYPES.includes(patch.itemType)) return { error: 'Invalid item type.' };
    row.item_type = patch.itemType;
  }
  if (Object.keys(row).length === 0) return;

  const { error } = await supabase.from('boq_items').update(row).eq('id', itemId);
  if (error) return { error: error.message };
  await touchBoq(supabase, boqId);
  revalidatePath(`/boq/${boqId}`);
}

export async function deleteItem(boqId: string, itemId: string): Promise<Err | void> {
  const { supabase } = await requireOrg();
  const { error } = await supabase.from('boq_items').delete().eq('id', itemId);
  if (error) return { error: error.message };
  await touchBoq(supabase, boqId);
  revalidatePath(`/boq/${boqId}`);
}

/** Deep-copy a bill (header + sections + items) into a fresh draft — the "similar
 *  job, slightly different scope" flow. Returns the new bill's id. */
export async function duplicateBoq(boqId: string): Promise<Ok<{ id: string }> | Err> {
  const { supabase, userId, orgId } = await requireOrg();

  const { data } = await supabase
    .from('boqs')
    .select(
      'name, boq_type, client_id, client_name, industry, reference, location, boq_date, currency, is_template, ' +
        'boq_sections(name, position, boq_items(description, uom, qty, budget_rate_cents, item_type, position))',
    )
    .eq('id', boqId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!data) return { error: 'BOQ not found.' };

  type ItemRow = {
    description: string;
    uom: string | null;
    qty: number | string | null;
    budget_rate_cents: number | string | null;
    item_type: BoqItemType;
    position: number;
  };
  type Src = {
    name: string;
    boq_type: string;
    client_id: string | null;
    client_name: string | null;
    industry: string | null;
    reference: string | null;
    location: string | null;
    boq_date: string | null;
    currency: string;
    is_template: boolean;
    boq_sections: { name: string; position: number; boq_items: ItemRow[] | null }[] | null;
  };
  const s = data as unknown as Src;

  const { data: nb, error: be } = await supabase
    .from('boqs')
    .insert({
      org_id: orgId,
      name: `${s.name} (copy)`,
      boq_type: s.boq_type,
      client_id: s.client_id,
      client_name: s.client_name,
      industry: s.industry,
      reference: s.reference,
      location: s.location,
      boq_date: s.boq_date,
      currency: s.currency,
      is_template: s.is_template,
      status: 'draft',
      created_by: userId,
    })
    .select('id')
    .single();
  if (be) return { error: be.message };
  const newId = (nb as { id: string }).id;

  for (const sec of (s.boq_sections ?? []).slice().sort((a, b) => a.position - b.position)) {
    const { data: ns, error: se } = await supabase
      .from('boq_sections')
      .insert({ org_id: orgId, boq_id: newId, name: sec.name, position: sec.position })
      .select('id')
      .single();
    if (se || !ns) continue;
    const items = (sec.boq_items ?? []).slice().sort((a, b) => a.position - b.position);
    if (items.length) {
      await supabase.from('boq_items').insert(
        items.map((it) => ({
          org_id: orgId,
          section_id: (ns as { id: string }).id,
          description: it.description,
          uom: it.uom,
          qty: it.qty,
          budget_rate_cents: it.budget_rate_cents,
          item_type: it.item_type,
          position: it.position,
        })),
      );
    }
  }

  revalidatePath('/boq');
  return { id: newId };
}

export interface ImportItem {
  description: string;
  uom: string | null;
  qty: number;
  rateCents: number;
}
export interface ImportSection {
  name: string;
  items: ImportItem[];
}

/** Bulk-append parsed spreadsheet rows to a bill: create each section after the
 *  existing ones, then its items. The client does the parsing + column mapping;
 *  this only trusts the structured result, re-clamps it, and writes under RLS. */
export async function importBoqRows(
  boqId: string,
  sections: ImportSection[],
): Promise<Ok<{ sections: number; items: number }> | Err> {
  const { supabase, orgId } = await requireOrg();

  const totalItems = sections.reduce((a, s) => a + s.items.length, 0);
  if (totalItems === 0) return { error: 'Nothing to import — no priced items were found.' };
  if (totalItems > 2000) return { error: 'That sheet has over 2000 items — split it and import in parts.' };

  const { data: last } = await supabase
    .from('boq_sections')
    .select('position')
    .eq('boq_id', boqId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  let pos = ((last as { position: number } | null)?.position ?? -1) + 1;

  let secCount = 0;
  let itemCount = 0;
  for (const s of sections) {
    const { data: ns, error: se } = await supabase
      .from('boq_sections')
      .insert({ org_id: orgId, boq_id: boqId, name: (s.name || 'Untitled section').slice(0, 200), position: pos++ })
      .select('id')
      .single();
    if (se || !ns) return { error: se?.message ?? 'Failed to create a section.' };
    secCount++;
    if (s.items.length) {
      const rows = s.items.map((it, i) => ({
        org_id: orgId,
        section_id: (ns as { id: string }).id,
        description: (it.description || '').slice(0, 500),
        uom: it.uom ? it.uom.trim().slice(0, 24) || null : null,
        qty: Number.isFinite(it.qty) ? Math.max(0, it.qty) : 0,
        budget_rate_cents: Number.isFinite(it.rateCents) ? Math.max(0, Math.round(it.rateCents)) : 0,
        item_type: 'measured' as const,
        position: i,
      }));
      const { error: ie } = await supabase.from('boq_items').insert(rows);
      if (ie) return { error: ie.message };
      itemCount += rows.length;
    }
  }

  revalidatePath(`/boq/${boqId}`);
  return { sections: secCount, items: itemCount };
}

export async function setBoqStatus(boqId: string, status: BoqStatus): Promise<Err | void> {
  const { supabase } = await requireOrg();
  if (!BOQ_STATUSES.includes(status)) return { error: 'Invalid status.' };
  const { error } = await supabase.from('boqs').update({ status }).eq('id', boqId);
  if (error) return { error: error.message };
  revalidatePath(`/boq/${boqId}`);
  revalidatePath('/boq');
}
