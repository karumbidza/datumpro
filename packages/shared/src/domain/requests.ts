/** Requests & authorisation. A request flows draft → submitted → (approved|rejected)
 *  through an ordered approval chain. A *variation* that is approved produces a
 *  variation order that adjusts the project budget/schedule. */

export const REQUEST_TYPES = ['rfi', 'purchase', 'variation', 'access'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const APPROVAL_DECISIONS = ['pending', 'approved', 'rejected'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Requests that carry a monetary amount and therefore route through finance
 *  approval thresholds. */
export const AMOUNT_BEARING_REQUEST_TYPES: readonly RequestType[] = ['purchase', 'variation'];

export function isAmountBearing(type: RequestType): boolean {
  return AMOUNT_BEARING_REQUEST_TYPES.includes(type);
}
