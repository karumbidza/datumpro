import type { TaskPriority, TaskStatus, TaskSlaStatus } from '@datumpro/shared/domain';
import type { BadgeTone } from './badge';

/**
 * Semantic → Badge tone maps. ONE colour language for the whole app:
 * priority reads urgent=red / high=orange / medium+low=quiet, everywhere.
 */
export const PRIORITY_TONE: Record<TaskPriority, BadgeTone> = {
  urgent: 'red',
  high: 'orange',
  medium: 'neutral',
  low: 'faint',
};

export const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  done: 'green',
  blocked: 'amber',
  in_progress: 'blue',
  submitted: 'blue',
  todo: 'neutral',
};

export const SLA_TONE: Record<TaskSlaStatus, BadgeTone> = {
  on_track: 'green',
  at_risk: 'amber',
  pending_signoff: 'blue',
  blocked: 'amber',
  breached: 'red',
  resolved_on_time: 'neutral',
  resolved_late: 'neutral',
};
