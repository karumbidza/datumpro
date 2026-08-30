/** Client-safe variation-order types + labels. Kept out of the server-only
 *  `variations.ts` so the register client component can import the shapes and
 *  label maps without pulling a server module into the browser bundle. */

export type VariationStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const STATUS_LABEL: Record<VariationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

export interface Variation {
  id: string;
  number: number;
  projectId: string;
  reference: string | null;
  description: string;
  costImpactCents: number; // may be negative (a credit)
  timeImpactDays: number;
  status: VariationStatus;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** Contract-impact totals across approved variations, for the register banner. */
export interface VariationTotals {
  approvedCostCents: number; // net of approved variations (credits reduce it)
  approvedTimeDays: number;
  pendingCount: number; // submitted, awaiting a decision
}
