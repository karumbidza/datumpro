/** Client-safe transmittal types + labels. Kept out of the server-only
 *  `transmittals.ts` so the register client component can import the shapes and
 *  label maps without pulling a server module into the browser bundle. */

export type TransmittalPurpose = 'for_construction' | 'for_review' | 'for_approval' | 'for_information' | 'for_record';
export type TransmittalMethod = 'email' | 'hand' | 'courier' | 'portal' | 'other';

export const PURPOSE_LABEL: Record<TransmittalPurpose, string> = {
  for_construction: 'For construction',
  for_review: 'For review',
  for_approval: 'For approval',
  for_information: 'For information',
  for_record: 'For record',
};

export const METHOD_LABEL: Record<TransmittalMethod, string> = {
  email: 'Email',
  hand: 'By hand',
  courier: 'Courier',
  portal: 'Portal',
  other: 'Other',
};

export interface TransmittalItem {
  id: string;
  drawingRevisionId: string | null;
  drawingNumber: string;
  revision: string | null;
  title: string | null;
}

export interface Transmittal {
  id: string;
  number: number;
  projectId: string;
  recipient: string;
  recipientUserId: string | null;
  purpose: TransmittalPurpose;
  method: TransmittalMethod;
  issuedDate: string; // YYYY-MM-DD
  notes: string | null;
  issuedByName: string | null;
  createdAt: string;
  items: TransmittalItem[];
}

/** A drawing revision offered in the "documents to transmit" picker. */
export interface TransmittalDrawingOption {
  revisionId: string;
  number: string;
  revision: string;
  title: string;
  status: string; // current revision status label-key
}
