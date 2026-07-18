/** Project lifecycle. Industry "packs" (construction/marketing/IT) are templates
 *  over this same engine — they don't fork the model. */

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_TYPES = ['construction', 'marketing', 'it', 'general'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Construction work-type (distinct from the generic vertical PROJECT_TYPES).
 *  Backs projects.construction_type; used by the create form's "Project type". */
export const CONSTRUCTION_TYPES = [
  'new_build',
  'renovation',
  'fit_out',
  'civils',
  'mep',
  'maintenance',
  'other',
] as const;
export type ConstructionType = (typeof CONSTRUCTION_TYPES)[number];

export const CONSTRUCTION_TYPE_LABELS: Record<ConstructionType, string> = {
  new_build: 'New build',
  renovation: 'Renovation',
  fit_out: 'Fit-out',
  civils: 'Civils',
  mep: 'MEP',
  maintenance: 'Maintenance',
  other: 'Other',
};

/** Per-project currency. Zimbabwe runs USD or ZWG. */
export const CURRENCIES = ['USD', 'ZWG'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Duration is entered in weeks or days; stored as working days. */
export const DURATION_UNITS = ['weeks', 'days'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const MILESTONE_STATUSES = ['pending', 'in_progress', 'done', 'missed'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
