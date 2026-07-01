/** Task commitments — the contractor negotiation on a task. Vocabulary shared by
 *  web, mobile, and the DB enums. See docs/FUNCTIONAL_SPEC.md.
 *
 *  Lifecycle:  offered → (contractor) accepted | counter_proposed | declined
 *              accepted/counter_proposed → (PM) agreed | declined
 *  On `agreed` the cost is locked and becomes the task's Earned-Value weight.
 */

export const COMMITMENT_STATUSES = [
  'offered',
  'accepted',
  'counter_proposed',
  'agreed',
  'declined',
  'cancelled',
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

/** A commitment the contractor still has to respond to. */
export const COMMITMENT_AWAITING_CONTRACTOR: CommitmentStatus[] = ['offered'];
/** The contractor has responded; the PM must now decide. */
export const COMMITMENT_AWAITING_PM: CommitmentStatus[] = ['accepted', 'counter_proposed'];

export interface PaymentMilestone {
  label: string;
  /** Percentage of the agreed cost released at this milestone. */
  pct: number;
}

/** Structured payment terms captured on the commitment. Advance + retention +
 *  named milestones; the remainder is implicitly "balance on completion". */
export interface PaymentTerms {
  advancePct?: number;
  retentionPct?: number;
  milestones?: PaymentMilestone[];
}

/** Normalise arbitrary JSON (from the DB) into PaymentTerms, dropping junk. */
export function parsePaymentTerms(raw: unknown): PaymentTerms {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const milestones = Array.isArray(r.milestones)
    ? r.milestones
        .map((m) => {
          const mm = m as Record<string, unknown>;
          const pct = num(mm.pct);
          return typeof mm.label === 'string' && pct !== undefined ? { label: mm.label, pct } : null;
        })
        .filter((m): m is PaymentMilestone => m !== null)
    : undefined;
  return { advancePct: num(r.advancePct), retentionPct: num(r.retentionPct), milestones };
}

/** One-line human summary of terms, e.g. "30% advance · 5% retention · 2 milestones". */
export function paymentTermsSummary(terms: PaymentTerms): string {
  const parts: string[] = [];
  if (terms.advancePct) parts.push(`${terms.advancePct}% advance`);
  if (terms.retentionPct) parts.push(`${terms.retentionPct}% retention`);
  if (terms.milestones?.length) parts.push(`${terms.milestones.length} milestone${terms.milestones.length === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'Balance on completion';
}
