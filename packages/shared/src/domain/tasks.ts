/** Task engine — the unit of assigned work. See docs/FUNCTIONAL_SPEC.md.
 *  SLA computation (clock/deadline crediting) lives alongside these in later code;
 *  here we expose the vocabulary shared by web, mobile, and the DB enums. */

export const TASK_STATUSES = ['todo', 'in_progress', 'submitted', 'blocked', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SLA_STATUSES = [
  'on_track',
  'at_risk',
  'pending_signoff',
  'blocked',
  'breached',
  'resolved_on_time',
  'resolved_late',
] as const;
export type TaskSlaStatus = (typeof TASK_SLA_STATUSES)[number];

/** Human labels for the task vocabulary — raw enum strings never reach the UI. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  submitted: 'In review',
  blocked: 'Blocked',
  done: 'Done',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const TASK_SLA_LABELS: Record<TaskSlaStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  pending_signoff: 'Pending sign-off',
  blocked: 'Blocked',
  breached: 'Breached',
  resolved_on_time: 'Resolved on time',
  resolved_late: 'Resolved late',
};

/** Only these org roles may approve a task to DONE (mirrors the DB sign-off guard). */
export const TASK_SIGNOFF_ROLES = ['owner', 'admin', 'pm'] as const;
