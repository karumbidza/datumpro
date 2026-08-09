/** Bill of Quantities (Estimates) — shared enums, metric units and labels.
 *  Raw enum strings never reach the UI; components read the *_LABELS maps. */

export const BOQ_STATUSES = ['draft', 'approved', 'archived'] as const;
export type BoqStatus = (typeof BOQ_STATUSES)[number];
export const BOQ_STATUS_LABELS: Record<BoqStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  archived: 'Archived',
};

/** How a whole bill was produced — declared at creation (mandatory). Distinct
 *  from an individual line's BOQ_ITEM_TYPE. */
export const BOQ_TYPES = ['measured', 'estimate', 'from_drawing'] as const;
export type BoqType = (typeof BOQ_TYPES)[number];
export const BOQ_TYPE_LABELS: Record<BoqType, string> = {
  measured: 'Measured',
  estimate: 'Estimate',
  from_drawing: 'From drawing',
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

/** Recognised metric (SI) units of measure. Units are free-text on a line (a bill
 *  can carry any convention), but the builder autocompletes from this list and
 *  flags anything not on it — a soft, non-blocking check. */
export const BOQ_UNITS = [
  'mm', 'm', 'km', 'm²', 'm³', 'L', 'kL', 'g', 'kg', 't',
  'nr', 'item', 'set', 'pair', 'sum', '%', 'hr', 'day', 'week', 'month',
] as const;
export type BoqUnit = (typeof BOQ_UNITS)[number];

const KNOWN_UNITS = new Set<string>(BOQ_UNITS.map((u) => u.toLowerCase()));
/** Is this a recognised unit? Empty = not yet set (treated as fine). Case- and
 *  whitespace-insensitive; also accepts the ASCII spellings m2 / m3. */
export function isKnownUnit(u: string | null | undefined): boolean {
  const v = (u ?? '').trim().toLowerCase();
  if (v === '') return true;
  return KNOWN_UNITS.has(v) || v === 'm2' || v === 'm3';
}

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
