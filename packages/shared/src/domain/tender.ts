/** Sealed-tender statuses — shared enums + labels. Raw enum strings never reach
 *  the UI; components read the *_LABELS maps. Mirrors domain/boq.ts. */

export const TENDER_STATUSES = ['draft', 'open', 'closed', 'awarded', 'cancelled'] as const;
export type TenderStatus = (typeof TENDER_STATUSES)[number];
export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  draft: 'Draft',
  open: 'Open for bids',
  closed: 'Closed',
  awarded: 'Awarded',
  cancelled: 'Cancelled',
};

export const BIDDER_STATUSES = ['invited', 'viewing', 'submitted', 'withdrawn'] as const;
export type BidderStatus = (typeof BIDDER_STATUSES)[number];
export const BIDDER_STATUS_LABELS: Record<BidderStatus, string> = {
  invited: 'Invited',
  viewing: 'Viewing',
  submitted: 'Submitted',
  withdrawn: 'Withdrawn',
};
