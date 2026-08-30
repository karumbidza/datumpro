/** Client-safe programme (Gantt) types. Kept out of the server-only
 *  `programme.ts` so the timeline client component can import the shapes without
 *  pulling a server module into the browser bundle. */

import type { TaskStatus, TaskPriority } from '@datumpro/shared/domain';

export interface ProgrammeTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string | null;
  startIso: string; // YYYY-MM-DD, resolved window start
  endIso: string; // YYYY-MM-DD, resolved window end (inclusive)
  /** True when the task has a real planned window (not just a single due-day fallback). */
  scheduled: boolean;
  critical: boolean;
  floatDays: number;
  waitingOn: string[]; // predecessor titles not yet done
}

export interface ProgrammeEdge {
  predecessorId: string;
  successorId: string;
  lagDays: number;
}

export interface UnscheduledTask {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface ProgrammeData {
  tasks: ProgrammeTask[]; // has a window, sorted by start then critical
  unscheduled: UnscheduledTask[]; // no dates yet
  edges: ProgrammeEdge[]; // dependencies among scheduled tasks
  rangeStartIso: string | null; // earliest bar start
  rangeEndIso: string | null; // latest bar end
  projectStart: string | null;
  projectedFinish: string | null;
  baselineFinish: string | null;
  hasCycle: boolean;
}
