/**
 * Canonical styling for list-page table headers — the uppercase label row above
 * simple data tables (Finance, BOQ index, tender invites, Audit log). Keeps every
 * list table's header identical instead of each page re-typing slightly different
 * borders, greys and weights.
 *
 * Dense editable grids (BOQ builder, tender comparison, bid workspace) use their
 * own heavier bordered-cell style and intentionally do NOT use these.
 */

/** The header `<tr>` — put this on the row inside `<thead>`. */
export const theadRowClass =
  'border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400';

/** A header cell `<th>`. Append `text-right` for numeric columns, or width
 *  utilities as needed. */
export const thClass = 'px-4 py-2.5 font-semibold';
