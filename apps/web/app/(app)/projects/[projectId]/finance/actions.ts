'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const toCents = (dollars: unknown) => Math.round((Number(dollars) || 0) * 100);

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

async function projectOrg(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string) {
  const { data } = await supabase.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  if (!data) throw new Error('Project not found or access denied');
  return (data as { org_id: string }).org_id;
}

export async function addBudgetLine(formData: FormData) {
  const { supabase } = await ctx();
  const projectId = String(formData.get('projectId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  if (!description) throw new Error('Description is required');
  const orgId = await projectOrg(supabase, projectId);

  const { error } = await supabase.from('budget_lines').insert({
    org_id: orgId,
    project_id: projectId,
    description,
    category: (formData.get('category') as string) || null,
    quantity: Number(formData.get('quantity')) || 1,
    rate_cents: toCents(formData.get('rate')),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/finance`);
}

export async function createInvoice(formData: FormData) {
  const { supabase, user } = await ctx();
  const projectId = String(formData.get('projectId') ?? '');
  const orgId = await projectOrg(supabase, projectId);

  let lines: { description: string; quantity: number; unitPriceCents: number }[] = [];
  try {
    lines = JSON.parse(String(formData.get('lines') ?? '[]'));
  } catch {
    throw new Error('Invalid line items');
  }
  lines = lines.filter((l) => l.description?.trim() && l.quantity > 0);
  if (lines.length === 0) throw new Error('Add at least one line item');

  const subtotal = lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPriceCents), 0);
  const number = String(formData.get('number') || `INV-${Date.now().toString().slice(-8)}`);

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      org_id: orgId,
      project_id: projectId,
      number,
      due_date: (formData.get('dueDate') as string) || null,
      payment_terms: (formData.get('paymentTerms') as string) || null,
      subtotal_cents: subtotal,
      total_cents: subtotal,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message.includes('invoices_org_number_key') ? 'That invoice number already exists' : error.message);

  const invoiceId = (invoice as { id: string }).id;
  const { error: linesError } = await supabase.from('invoice_lines').insert(
    lines.map((l) => ({
      org_id: orgId,
      invoice_id: invoiceId,
      description: l.description.trim(),
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
    })),
  );
  if (linesError) throw new Error(linesError.message);

  revalidatePath(`/projects/${projectId}/finance`);
  redirect(`/projects/${projectId}/finance/invoices/${invoiceId}`);
}

export async function recordPayment(formData: FormData) {
  const { supabase, user } = await ctx();
  const projectId = String(formData.get('projectId') ?? '');
  const invoiceId = String(formData.get('invoiceId') ?? '');
  const amountCents = toCents(formData.get('amount'));
  if (amountCents <= 0) throw new Error('Amount must be greater than zero');

  const { data: invoice } = await supabase
    .from('invoices')
    .select('org_id, total_cents')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!invoice) throw new Error('Invoice not found');
  const orgId = (invoice as { org_id: string; total_cents: number }).org_id;

  const { error } = await supabase.from('payments').insert({
    org_id: orgId,
    invoice_id: invoiceId,
    amount_cents: amountCents,
    method: (formData.get('method') as string) || 'bank_transfer',
    status: 'confirmed',
    reference: (formData.get('reference') as string) || null,
    paid_at: new Date().toISOString(),
    recorded_by: user.id,
  });
  if (error) throw new Error(error.message);

  // Update invoice status from the confirmed-payment total.
  const { data: pays } = await supabase
    .from('payments')
    .select('amount_cents')
    .eq('invoice_id', invoiceId)
    .eq('status', 'confirmed');
  const paid = ((pays ?? []) as { amount_cents: number }[]).reduce((a, p) => a + p.amount_cents, 0);
  const total = (invoice as { total_cents: number }).total_cents;
  const status = paid >= total ? 'paid' : paid > 0 ? 'part_paid' : 'sent';
  await supabase.from('invoices').update({ status }).eq('id', invoiceId);

  revalidatePath(`/projects/${projectId}/finance/invoices/${invoiceId}`);
}

export async function submitPop(formData: FormData) {
  const { supabase, user } = await ctx();
  const projectId = String(formData.get('projectId') ?? '');
  const invoiceId = String(formData.get('invoiceId') ?? '');
  const reference = String(formData.get('reference') ?? '').trim();
  if (!reference) throw new Error('A document reference is required');

  const { data: invoice } = await supabase.from('invoices').select('org_id').eq('id', invoiceId).maybeSingle();
  if (!invoice) throw new Error('Invoice not found');

  const { error } = await supabase.from('proof_of_payments').insert({
    org_id: (invoice as { org_id: string }).org_id,
    invoice_id: invoiceId,
    storage_path: reference, // real file upload to Supabase Storage comes later
    note: (formData.get('note') as string) || null,
    submitted_by: user.id,
    status: 'submitted',
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/finance/invoices/${invoiceId}`);
}

export async function verifyPop(formData: FormData) {
  const { supabase, user } = await ctx();
  const projectId = String(formData.get('projectId') ?? '');
  const invoiceId = String(formData.get('invoiceId') ?? '');
  const popId = String(formData.get('popId') ?? '');

  // The DB enforces segregation of duties (verifier ≠ submitter) and that only
  // finance/admin/owner can update.
  const { error } = await supabase
    .from('proof_of_payments')
    .update({ status: 'verified', verified_by: user.id, verified_at: new Date().toISOString() })
    .eq('id', popId);
  if (error) {
    throw new Error(
      error.message.includes('pop_verifier_not_submitter')
        ? 'You cannot verify a proof of payment you submitted yourself'
        : error.message,
    );
  }
  revalidatePath(`/projects/${projectId}/finance/invoices/${invoiceId}`);
}
