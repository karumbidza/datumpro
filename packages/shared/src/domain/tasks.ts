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

/** Only these org roles may approve a task to DONE (mirrors the DB sign-off guard). */
export const TASK_SIGNOFF_ROLES = ['owner', 'admin', 'pm'] as const;
