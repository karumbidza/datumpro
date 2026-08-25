import { createClient } from '@/lib/supabase/server';
import type { BoqItemType, BoqType, TenderStatus } from '@datumpro/shared/domain';

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
  projectId: string | null;
  projectName: string | null;
}

/** All bills in the org, newest first — the Estimates index. RLS scopes to the
 *  org; item count and total are rolled up from the nested items. */
export async function listBoqs(orgId: string): Promise<BoqListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boqs')
    .select(
      'id, name, client_name, industry, status, currency, boq_date, updated_at, project_id, projects(name), ' +
        'boq_sections(boq_items(amount_cents))',
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
    project_id: string | null;
    projects: { name: string } | null;
    boq_sections: { boq_items: { amount_cents: number | string | null }[] | null }[] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => {
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
      projectId: r.project_id,
      projectName: r.projects?.name ?? null,
    };
  });
}

export interface BoqItem {
  id: string;
  sectionId: string;
  itemNo: string | null;
  description: string;
  uom: string | null;
  qty: number;
  budgetRateCents: number;
  itemType: BoqItemType;
  position: number;
  amountCents: number;
}

/** A section can be a sub-topic of another via parentId (null = top level). The
 *  builder nests them; both sections and items are returned FLAT and assembled
 *  client-side, which keeps mutation state simple. */
export interface BoqSection {
  id: string;
  name: string;
  position: number;
  parentId: string | null;
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
  projectId: string | null;
  projectName: string | null;
  /** Latest tender's status, so the bill can show "Out to tender" etc. Null when
   *  the bill has never been put out to tender. */
  tenderStatus: TenderStatus | null;
  sections: BoqSection[];
  items: BoqItem[];
}

/** One bill with its sections (nestable) and priced items, both flat. Returns
 *  null when the id isn't visible to the caller (RLS) or doesn't exist. */
export async function getBoqDetail(orgId: string, boqId: string): Promise<BoqDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boqs')
    .select(
      'id, name, boq_type, client_name, industry, reference, location, boq_date, currency, status, ' +
        'project_id, projects(name), boq_tenders(status, created_at), ' +
        'boq_sections(id, name, position, parent_id, ' +
        'boq_items(id, item_no, description, uom, qty, budget_rate_cents, item_type, position, amount_cents))',
    )
    .eq('id', boqId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!data) return null;

  type ItemRow = {
    id: string;
    item_no: string | null;
    description: string;
    uom: string | null;
    qty: number | string | null;
    budget_rate_cents: number | string | null;
    item_type: BoqItemType;
    position: number;
    amount_cents: number | string | null;
  };
  type SectionRow = { id: string; name: string; position: number; parent_id: string | null; boq_items: ItemRow[] | null };
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
    project_id: string | null;
    projects: { name: string } | null;
    boq_tenders: { status: string; created_at: string }[] | null;
    boq_sections: SectionRow[] | null;
  };

  // The select is built by concatenation, so supabase-js can't infer the row
  // shape (it widens to a parse-error type); assert through unknown to our type.
  const b = data as unknown as BoqRow;
  const secRows = (b.boq_sections ?? []).slice().sort((a, c) => a.position - c.position);

  const sections: BoqSection[] = secRows.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    parentId: s.parent_id,
  }));
  const items: BoqItem[] = [];
  for (const s of secRows) {
    for (const it of (s.boq_items ?? []).slice().sort((a, c) => a.position - c.position)) {
      items.push({
        id: it.id,
        sectionId: s.id,
        itemNo: it.item_no,
        description: it.description,
        uom: it.uom,
        qty: n(it.qty),
        budgetRateCents: n(it.budget_rate_cents),
        itemType: it.item_type,
        position: it.position,
        amountCents: n(it.amount_cents),
      });
    }
  }

  // Latest tender wins; only surface live states (a draft/cancelled tender reads
  // as "not out to tender").
  const latestTender = (b.boq_tenders ?? [])
    .slice()
    .sort((a, c) => c.created_at.localeCompare(a.created_at))[0];
  const liveTender = new Set(['open', 'closed', 'awarded']);
  const tenderStatus =
    latestTender && liveTender.has(latestTender.status) ? (latestTender.status as TenderStatus) : null;

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
    projectId: b.project_id,
    projectName: b.projects?.name ?? null,
    tenderStatus,
    sections,
    items,
  };
}

export interface UnlinkedBoqOption {
  id: string;
  name: string;
  status: string;
  itemCount: number;
  totalCents: number;
  currency: string;
}

/** Bills that can be attached to a project: not templates, not already linked.
 *  Any status — a draft can be attached and generated from whatever lines exist. */
export async function listUnlinkedBoqs(orgId: string): Promise<UnlinkedBoqOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boqs')
    .select('id, name, status, currency, boq_sections(boq_items(amount_cents))')
    .eq('org_id', orgId)
    .eq('is_template', false)
    .is('project_id', null)
    .order('updated_at', { ascending: false });

  type Row = {
    id: string;
    name: string;
    status: string;
    currency: string;
    boq_sections: { boq_items: { amount_cents: number | string | null }[] | null }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const items = (r.boq_sections ?? []).flatMap((s) => s.boq_items ?? []);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      currency: r.currency,
      itemCount: items.length,
      totalCents: items.reduce((a, it) => a + n(it.amount_cents), 0),
    };
  });
}

export interface ProjectBoqSummary {
  id: string;
  name: string;
  status: string;
  currency: string;
  updatedAt: string;
  sectionCount: number;
  itemCount: number;
  totalCents: number;
  tasksGenerated: boolean;
  generatedAt: string | null;
  changedSinceGeneration: boolean;
  tenderStatus: string | null;
}

/** The BOQ attached to a project (first by created_at when several), with the
 *  generation + drift state the project BOQ tab renders. Null when unlinked. */
export async function getProjectBoq(orgId: string, projectId: string): Promise<ProjectBoqSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('boqs')
    .select(
      'id, name, status, currency, updated_at, ' +
        'boq_sections(id, boq_items(amount_cents)), boq_tenders(status, created_at)',
    )
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  type Row = {
    id: string;
    name: string;
    status: string;
    currency: string;
    updated_at: string;
    boq_sections: { id: string; boq_items: { amount_cents: number | string | null }[] | null }[] | null;
    boq_tenders: { status: string; created_at: string }[] | null;
  };
  const r = data as unknown as Row;
  const sections = r.boq_sections ?? [];
  const items = sections.flatMap((s) => s.boq_items ?? []);

  // Generation state: any project task pointing at one of this bill's sections.
  const sectionIds = sections.map((s) => s.id);
  let tasksGenerated = false;
  let generatedAt: string | null = null;
  if (sectionIds.length > 0) {
    const { data: t } = await supabase
      .from('tasks')
      .select('created_at')
      .eq('project_id', projectId)
      .in('boq_section_id', sectionIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (t) {
      tasksGenerated = true;
      generatedAt = (t as { created_at: string }).created_at;
    }
  }

  const tenders = (r.boq_tenders ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    currency: r.currency,
    updatedAt: r.updated_at,
    sectionCount: sections.length,
    itemCount: items.length,
    totalCents: items.reduce((a, it) => a + n(it.amount_cents), 0),
    tasksGenerated,
    generatedAt,
    // touchBoq bumps boqs.updated_at on every section/item mutation, so this is
    // a faithful "bill changed after tasks were cut" signal.
    changedSinceGeneration: tasksGenerated && generatedAt !== null && r.updated_at > generatedAt,
    tenderStatus: tenders[0]?.status ?? null,
  };
}

export interface BoqGeneratedTask {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  acceptanceStatus: string | null;
}

/** The tasks generated from a bill, in section order — the bulk-assign list. */
export async function listBoqGeneratedTasks(
  orgId: string,
  projectId: string,
  boqId: string,
): Promise<BoqGeneratedTask[]> {
  const supabase = await createClient();
  const { data: secs } = await supabase.from('boq_sections').select('id').eq('boq_id', boqId).eq('org_id', orgId);
  const sectionIds = ((secs ?? []) as { id: string }[]).map((s) => s.id);
  if (sectionIds.length === 0) return [];

  const { data } = await supabase
    .from('tasks')
    .select('id, title, status, assignee_id, acceptance_status')
    .eq('project_id', projectId)
    .in('boq_section_id', sectionIds)
    .order('created_at', { ascending: true });

  type Row = {
    id: string;
    title: string;
    status: string;
    assignee_id: string | null;
    acceptance_status: string | null;
  };
  return ((data ?? []) as Row[]).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assigneeId: t.assignee_id,
    acceptanceStatus: t.acceptance_status,
  }));
}
