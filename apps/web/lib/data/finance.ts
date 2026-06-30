import { createClient } from '@/lib/supabase/server';
import type { InvoiceStatus, PaymentStatus, PopStatus } from '@datumpro/shared/domain';

export interface BudgetLineRow {
  id: string;
  description: string;
  category: string | null;
  quantity: number;
  rate_cents: number;
  budget_amount_cents: number;
}
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

export async function listBudgetLines(projectId: string): Promise<BudgetLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('budget_lines')
    .select('id, description, category, quantity, rate_cents, budget_amount_cents')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BudgetLineRow[];
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

/** Project money summary in cents: budget, invoiced, paid, outstanding.
 *  Payments carry invoice_id (not project_id), so paid is computed via the
 *  project's invoices. */
export async function financeSummary(projectId: string) {
  const supabase = await createClient();
  const [budget, invoicesRes] = await Promise.all([
    supabase.from('budget_lines').select('budget_amount_cents').eq('project_id', projectId),
    supabase.from('invoices').select('id, total_cents, status').eq('project_id', projectId),
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

  return { budgetCents, invoicedCents, paidCents, outstandingCents: invoicedCents - paidCents };
}
