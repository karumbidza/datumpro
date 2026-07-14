/** Contractor payment requests (buy-side). A contractor asks to be paid — against
 *  a scheduled draw or as an ad-hoc invoice — and the manager approves, pays, and
 *  files a proof-of-payment. Amounts are integer cents. */

export const PAYMENT_REQUEST_STATUSES = ['requested', 'approved', 'paid', 'rejected'] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const PAYMENT_REQUEST_STATUS_LABEL: Record<PaymentRequestStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
};
