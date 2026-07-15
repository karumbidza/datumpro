import { createClient } from '@/lib/supabase/server';

/** Project finance rollup (buy-side, request-and-pay): how much has been committed
 *  to contractors and how much has been paid, from the payment schedule (draws).
 *  No client-side invoicing — the contractor's payment request is the invoice. */
export async function financeSummary(
  projectId: string,
): Promise<{ committedCostCents: number; costToDateCents: number }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payment_schedule')
    .select('amount_cents, status')
    .eq('project_id', projectId);
  const draws = (data ?? []) as { amount_cents: number; status: string }[];
  const committedCostCents = draws.reduce((a, d) => a + (d.amount_cents ?? 0), 0);
  const costToDateCents = draws
    .filter((d) => d.status === 'paid')
    .reduce((a, d) => a + (d.amount_cents ?? 0), 0);
  return { committedCostCents, costToDateCents };
}
