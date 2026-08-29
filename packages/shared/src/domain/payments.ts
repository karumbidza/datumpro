/** Contractor payment requests (buy-side). A contractor asks to be paid — against
 *  a scheduled draw or as an ad-hoc invoice — and the manager approves, pays, and
 *  files a proof-of-payment. Amounts are integer cents. */

export const PAYMENT_REQUEST_STATUSES = ['requested', 'approved', 'paid', 'rejected', 'cancelled'] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const PAYMENT_REQUEST_STATUS_LABEL: Record<PaymentRequestStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
};

/** A payment request is either a progress claim (milestone-gated against a task)
 *  or a retention release (the held retention, claimable once the defects-liability
 *  period has elapsed). */
export const PAYMENT_REQUEST_KINDS = ['milestone', 'retention'] as const;
export type PaymentRequestKind = (typeof PAYMENT_REQUEST_KINDS)[number];

export const PAYMENT_REQUEST_KIND_LABEL: Record<PaymentRequestKind, string> = {
  milestone: 'Progress claim',
  retention: 'Retention release',
};
