'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { createBoqSchema } from '@datumpro/shared/validation';
import { BOQ_UNITS, BOQ_ITEM_TYPES, BOQ_STATUSES, type BoqItemType, type BoqStatus } from '@datumpro/shared/domain';
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

  revalidatePath('/estimates');
  redirect(`/estimates/${(data as { id: string }).id}`);
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
  revalidatePath(`/estimates/${boqId}`);
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
  revalidatePath(`/estimates/${boqId}`);
}

export async function deleteSection(boqId: string, sectionId: string): Promise<Err | void> {
  const { supabase } = await requireOrg();
  const { error } = await supabase.from('boq_sections').delete().eq('id', sectionId);
  if (error) return { error: error.message };
  await touchBoq(supabase, boqId);
  revalidatePath(`/estimates/${boqId}`);
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
  revalidatePath(`/estimates/${boqId}`);
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
  if (patch.uom !== undefined) {
    if (patch.uom !== null && patch.uom !== '' && !BOQ_UNITS.includes(patch.uom as never)) {
      return { error: 'Unit must be metric.' };
    }
    row.uom = patch.uom || null;
  }
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
  revalidatePath(`/estimates/${boqId}`);
}

export async function deleteItem(boqId: string, itemId: string): Promise<Err | void> {
  const { supabase } = await requireOrg();
  const { error } = await supabase.from('boq_items').delete().eq('id', itemId);
  if (error) return { error: error.message };
  await touchBoq(supabase, boqId);
  revalidatePath(`/estimates/${boqId}`);
}

export async function setBoqStatus(boqId: string, status: BoqStatus): Promise<Err | void> {
  const { supabase } = await requireOrg();
  if (!BOQ_STATUSES.includes(status)) return { error: 'Invalid status.' };
  const { error } = await supabase.from('boqs').update({ status }).eq('id', boqId);
  if (error) return { error: error.message };
  revalidatePath(`/estimates/${boqId}`);
  revalidatePath('/estimates');
}
