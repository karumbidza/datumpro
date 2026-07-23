import { createClient } from '@/lib/supabase/server';

/** Project finance rollup (buy-side): committed = the agreed price of approved
 *  plans (awarded costs); paid = settled contractor payment requests. The
 *  contractor's payment request is the invoice — no scheduled draws. */
export async function financeSummary(
  projectId: string,
): Promise<{ committedCostCents: number; costToDateCents: number }> {
  const supabase = await createClient();
  const [tasksRes, reqsRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('awarded_cost_cents, plan_approved_at')
      .eq('project_id', projectId)
      .not('plan_approved_at', 'is', null),
    supabase
      .from('contractor_payment_requests')
      .select('amount_cents, status')
      .eq('project_id', projectId)
      .eq('status', 'paid'),
  ]);
  const committedCostCents = ((tasksRes.data ?? []) as { awarded_cost_cents: number | null }[]).reduce(
    (a, t) => a + (t.awarded_cost_cents ?? 0),
    0,
  );
  const costToDateCents = ((reqsRes.data ?? []) as { amount_cents: number }[]).reduce(
    (a, r) => a + (r.amount_cents ?? 0),
    0,
  );
  return { committedCostCents, costToDateCents };
}
