import type {
  TaskPriority,
  TaskStatus,
  TaskSlaStatus,
  ProjectStatus,
  BoqStatus,
  PaymentRequestStatus,
  ContractorDocStatus,
} from '@datumpro/shared/domain';
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

/**
 * Project status. Follows the same language as the task map above:
 * blue = in flight (active), green = finished (completed), amber = attention
 * (on hold), neutral = not started / archived.
 */
export const PROJECT_STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  active: 'blue',
  planning: 'neutral',
  on_hold: 'amber',
  completed: 'green',
  archived: 'neutral',
};

export const BOQ_STATUS_TONE: Record<BoqStatus, BadgeTone> = {
  draft: 'amber',
  approved: 'green',
  archived: 'faint',
};

export const PAYMENT_REQUEST_TONE: Record<PaymentRequestStatus, BadgeTone> = {
  requested: 'amber',
  approved: 'blue',
  paid: 'green',
  rejected: 'neutral',
};

export const CONTRACTOR_DOC_TONE: Record<ContractorDocStatus, BadgeTone> = {
  submitted: 'amber',
  verified: 'green',
  rejected: 'neutral',
};
