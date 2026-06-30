/** Finance — invoices out, payments in, proof-of-payment filing, and Paynow
 *  collection. USD-only in v1 (no FX). All amounts are integer **cents** to avoid
 *  floating-point money bugs. */

export const CURRENCY = 'USD' as const;

export const INVOICE_STATUSES = ['draft', 'sent', 'part_paid', 'paid', 'overdue', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['paynow', 'bank_transfer', 'cash', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'confirmed', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Proof of payment is a *filed document* a finance user verifies — distinct from
 *  the payment record itself (which Paynow can confirm automatically). */
export const POP_STATUSES = ['submitted', 'verified', 'rejected'] as const;
export type PopStatus = (typeof POP_STATUSES)[number];

export const PAYNOW_STATUSES = ['created', 'sent', 'paid', 'cancelled', 'failed'] as const;
export type PaynowStatus = (typeof PAYNOW_STATUSES)[number];

/** Money is stored and computed in integer cents; format only at the edges. */
export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY }).format(cents / 100);
}
