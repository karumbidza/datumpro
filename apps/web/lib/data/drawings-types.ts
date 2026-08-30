/** Client-safe drawings-register types + labels. Kept out of the server-only
 *  `drawings.ts` so the register client component can import the shapes and label
 *  maps without pulling a server module into the browser bundle. */

export type Discipline =
  | 'architectural'
  | 'structural'
  | 'civil'
  | 'mechanical'
  | 'electrical'
  | 'plumbing'
  | 'landscape'
  | 'survey'
  | 'other';

export type RevisionStatus = 'for_review' | 'for_construction' | 'for_information' | 'superseded' | 'as_built';

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  architectural: 'Architectural',
  structural: 'Structural',
  civil: 'Civil',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  landscape: 'Landscape',
  survey: 'Survey',
  other: 'Other',
};

export const STATUS_LABEL: Record<RevisionStatus, string> = {
  for_review: 'For review',
  for_construction: 'For construction',
  for_information: 'For information',
  superseded: 'Superseded',
  as_built: 'As-built',
};

export interface DrawingRevision {
  id: string;
  revision: string;
  status: RevisionStatus;
  issueDate: string | null; // YYYY-MM-DD
  url: string | null; // short-lived signed PDF URL
  filename: string | null;
  notes: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface Drawing {
  id: string;
  number: string;
  title: string;
  discipline: Discipline;
  createdByName: string | null;
  updatedAt: string;
  /** The current sheet: the newest non-superseded revision, else the newest. */
  current: DrawingRevision | null;
  revisions: DrawingRevision[]; // newest first, incl. superseded
}
