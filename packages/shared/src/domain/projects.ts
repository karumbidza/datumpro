/** Project lifecycle. Industry "packs" (construction/marketing/IT) are templates
 *  over this same engine — they don't fork the model. */

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_TYPES = ['construction', 'marketing', 'it', 'general'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const MILESTONE_STATUSES = ['pending', 'in_progress', 'done', 'missed'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
