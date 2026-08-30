/** Client-safe snagging types + labels. Kept out of the server-only `snags.ts`
 *  so client components (the register, the snag card) can import the shapes and
 *  label maps without pulling a server module into the browser bundle. */

export type SnagSeverity = 'minor' | 'major' | 'critical';
export type SnagStatus = 'open' | 'fixed' | 'verified' | 'reopened' | 'charged';

export const SEVERITY_LABEL: Record<SnagSeverity, string> = {
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
};

export const STATUS_LABEL: Record<SnagStatus, string> = {
  open: 'Open',
  fixed: 'Fixed — awaiting check',
  verified: 'Verified',
  reopened: 'Reopened',
  charged: 'Charged to retention',
};

export interface SnagPhoto {
  id: string;
  url: string | null; // short-lived signed URL from project-media
  caption: string | null;
  uploadedBy: string | null;
}

export interface Snag {
  id: string;
  number: number;
  projectId: string;
  taskId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  severity: SnagSeverity;
  status: SnagStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null; // YYYY-MM-DD
  fixedAt: string | null;
  verifiedAt: string | null;
  retentionDeductionId: string | null;
  deductionAmountCents: number | null;
  raisedBy: string | null;
  raisedByName: string | null;
  createdAt: string;
  updatedAt: string;
  photos: SnagPhoto[];
}

/** The project's defects-liability-period position, for the register banner. */
export interface ProjectDlp {
  practicalCompletionAt: string | null;
  releaseAt: string | null; // when retention releases = DLP end
  inDlp: boolean; // PC stamped and we're before the release date
}

/** A contractor the PM can assign a snag to / charge retention against. */
export interface SnagContractor {
  userId: string;
  name: string;
  availableRetentionCents: number | null; // null when retention figures aren't visible
}
