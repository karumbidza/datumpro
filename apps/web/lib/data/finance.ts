import { createClient } from '@/lib/supabase/server';
import type { InvoiceStatus, PaymentStatus, PopStatus } from '@datumpro/shared/domain';

export interface InvoiceRow {
  id: string;
  number: string;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  total_cents: number;
}
export interface InvoiceLineRow {
  id: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
}
export interface PaymentRow {
  id: string;
  amount_cents: number;
  method: string;
  status: PaymentStatus;
  reference: string | null;
  created_at: string;
}
export interface PopRow {
  id: string;
  storage_path: string;
  status: PopStatus;
  submitted_by: string | null;
  note: string | null;
}

export interface BudgetBillingRow {
  id: string;
  description: string;
  category: string | null;
  budgetCents: number;
  billedCents: number;
  remainingCents: number;
}

/** Budget/BOQ lines with how much has already been invoiced against each
 *  (via invoice_lines.budget_line_id, excluding void invoices). Powers both
 *  the "billed vs budget" view and the invoice builder's remaining amounts. */
export async function listBudgetBilling(projectId: string): Promise<BudgetBillingRow[]> {
  const supabase = await createClient();
  const [linesRes, invoicesRes] = await Promise.all([
    supabase
      .from('budget_lines')
      .select('id, description, category, budget_amount_cents')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase.from('invoices').select('id, status').eq('project_id', projectId),
  ]);

  const lines = (linesRes.data ?? []) as {
    id: string;
    description: string;
    category: string | null;
    budget_amount_cents: number;
  }[];
  const liveInvoiceIds = ((invoicesRes.data ?? []) as { id: string; status: string }[])
    .filter((i) => i.status !== 'void')
    .map((i) => i.id);

  const billed = new Map<string, number>();
  if (liveInvoiceIds.length > 0) {
    const { data: ilRows } = await supabase
      .from('invoice_lines')
      .select('budget_line_id, amount_cents')
      .in('invoice_id', liveInvoiceIds)
      .not('budget_line_id', 'is', null);
    for (const il of (ilRows ?? []) as { budget_line_id: string | null; amount_cents: number }[]) {
      if (!il.budget_line_id) continue;
      billed.set(il.budget_line_id, (billed.get(il.budget_line_id) ?? 0) + (il.amount_cents ?? 0));
    }
  }

  return lines.map((l) => {
    const budgetCents = l.budget_amount_cents ?? 0;
    const billedCents = billed.get(l.id) ?? 0;
    return {
      id: l.id,
      description: l.description,
      category: l.category,
      budgetCents,
      billedCents,
      remainingCents: budgetCents - billedCents,
    };
  });
}

export async function listInvoices(projectId: string): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('invoices')
    .select('id, number, issue_date, due_date, status, total_cents')
    .eq('project_id', projectId)
    .order('issue_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InvoiceRow[];
}

export interface InvoiceDetail {
  invoice: InvoiceRow & { project_id: string; org_id: string; payment_terms: string | null };
  lines: InvoiceLineRow[];
  payments: PaymentRow[];
  pops: PopRow[];
}

export async function getInvoiceDetail(invoiceId: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, org_id, project_id, number, issue_date, due_date, status, total_cents, payment_terms')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!invoice) return null;

  const [{ data: lines }, { data: payments }, { data: pops }] = await Promise.all([
    supabase.from('invoice_lines').select('id, description, quantity, unit_price_cents, amount_cents').eq('invoice_id', invoiceId),
    supabase.from('payments').select('id, amount_cents, method, status, reference, created_at').eq('invoice_id', invoiceId),
    supabase.from('proof_of_payments').select('id, storage_path, status, submitted_by, note').eq('invoice_id', invoiceId),
  ]);

  return {
    invoice: invoice as InvoiceDetail['invoice'],
    lines: (lines ?? []) as InvoiceLineRow[],
    payments: (payments ?? []) as PaymentRow[],
    pops: (pops ?? []) as PopRow[],
  };
}

/** Project money summary in cents. Two directions:
 *   • in  — budget, invoiced (to client), paid (by client), outstanding.
 *   • out — committedCost (all contractor draws) and costToDate (draws paid).
 *  Payments carry invoice_id (not project_id), so client `paid` is computed via
 *  the project's invoices; contractor cost comes from payment_schedule. */
export async function financeSummary(projectId: string) {
  const supabase = await createClient();
  const [budget, invoicesRes, drawsRes] = await Promise.all([
    supabase.from('budget_lines').select('budget_amount_cents').eq('project_id', projectId),
    supabase.from('invoices').select('id, total_cents, status').eq('project_id', projectId),
    supabase.from('payment_schedule').select('amount_cents, status').eq('project_id', projectId),
  ]);

  const budgetCents = ((budget.data ?? []) as { budget_amount_cents: number }[]).reduce(
    (a, r) => a + (r.budget_amount_cents ?? 0),
    0,
  );
  const invoices = (invoicesRes.data ?? []) as { id: string; total_cents: number; status: string }[];
  const invoicedCents = invoices.filter((i) => i.status !== 'void').reduce((a, i) => a + i.total_cents, 0);

  let paidCents = 0;
  const invoiceIds = invoices.map((i) => i.id);
  if (invoiceIds.length > 0) {
    const { data: payments } = await supabase
      .from('payments')
      .select('amount_cents, status')
      .in('invoice_id', invoiceIds);
    paidCents = ((payments ?? []) as { amount_cents: number; status: string }[])
      .filter((p) => p.status === 'confirmed')
      .reduce((a, p) => a + p.amount_cents, 0);
  }

  const draws = (drawsRes.data ?? []) as { amount_cents: number; status: string }[];
  const committedCostCents = draws.reduce((a, d) => a + (d.amount_cents ?? 0), 0);
  const costToDateCents = draws
    .filter((d) => d.status === 'paid')
    .reduce((a, d) => a + (d.amount_cents ?? 0), 0);

  return {
    budgetCents,
    invoicedCents,
    paidCents,
    outstandingCents: invoicedCents - paidCents,
    committedCostCents,
    costToDateCents,
  };
}
