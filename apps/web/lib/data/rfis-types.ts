/** Client-safe RFI types + labels. Kept out of the server-only `rfis.ts` so the
 *  RFI register client component can import the shapes and label maps without
 *  pulling a server module into the browser bundle. */

import type { Discipline } from './drawings-types';

export type RfiPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RfiStatus = 'open' | 'answered' | 'closed' | 'reopened';

export { DISCIPLINE_LABEL } from './drawings-types';
export type { Discipline } from './drawings-types';

export const PRIORITY_LABEL: Record<RfiPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const STATUS_LABEL: Record<RfiStatus, string> = {
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
  reopened: 'Reopened',
};

export interface RfiAttachment {
  id: string;
  url: string | null; // short-lived signed URL from project-media
  filename: string | null;
  caption: string | null;
  uploadedBy: string | null;
}

export interface Rfi {
  id: string;
  number: number;
  projectId: string;
  subject: string;
  detail: string | null;
  discipline: Discipline;
  priority: RfiPriority;
  status: RfiStatus;
  drawingId: string | null;
  drawingNumber: string | null;
  drawingTitle: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null; // YYYY-MM-DD
  answer: string | null;
  answeredAt: string | null;
  answeredByName: string | null;
  raisedBy: string | null;
  raisedByName: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: RfiAttachment[];
}

/** A drawing offered in the "reference a drawing" picker. */
export interface RfiDrawingRef {
  id: string;
  number: string;
  title: string;
}
