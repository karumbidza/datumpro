/** Bill of Quantities (Estimates) — shared enums, metric units and labels.
 *  Raw enum strings never reach the UI; components read the *_LABELS maps. */

export const BOQ_STATUSES = ['draft', 'approved', 'archived'] as const;
export type BoqStatus = (typeof BOQ_STATUSES)[number];
export const BOQ_STATUS_LABELS: Record<BoqStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  archived: 'Archived',
};

export const BOQ_ITEM_TYPES = ['measured', 'provisional_sum', 'prime_cost'] as const;
export type BoqItemType = (typeof BOQ_ITEM_TYPES)[number];
export const BOQ_ITEM_TYPE_LABELS: Record<BoqItemType, string> = {
  measured: 'Measured',
  provisional_sum: 'Provisional sum',
  prime_cost: 'Prime cost',
};
/** Short badge shown against a priced line (blank for ordinary measured work). */
export const BOQ_ITEM_TYPE_SHORT: Record<BoqItemType, string> = {
  measured: '',
  provisional_sum: 'P.Sum',
  prime_cost: 'PC',
};

/** Metric (SI) units of measure. This list MUST stay in lock-step with the check
 *  constraint on boq_items.uom (migration 20260101008200) — the DB rejects any
 *  value not here, keeping every bill on the metric standard. */
export const BOQ_UNITS = [
  'mm', 'm', 'km', 'm²', 'm³', 'L', 'kL', 'g', 'kg', 't',
  'nr', 'item', 'set', 'pair', 'sum', '%', 'hr', 'day', 'week', 'month',
] as const;
export type BoqUnit = (typeof BOQ_UNITS)[number];

/** Sector a BOQ is tagged with. Stored as free text (not an enum) so the same
 *  builder serves any industry; the list only drives the picker and, later,
 *  templates and cross-job benchmarks. */
export const BOQ_INDUSTRIES = [
  'Building & construction',
  'Civil engineering / infrastructure',
  'Mining & metals',
  'Oil & gas',
  'Manufacturing',
  'Energy & power',
  'Water & sanitation',
  'Agriculture',
  'ICT & telecoms',
  'Transport & logistics',
  'Facilities & maintenance',
  'Other',
] as const;
export type BoqIndustry = (typeof BOQ_INDUSTRIES)[number];
