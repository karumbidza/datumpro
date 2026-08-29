export type Kind = 'section' | 'item' | 'skip';
// A row carries qty/rate AND an amount; a lump-sum bill prices by amount alone
// (qty/rate may be text like "Item"/"Sum"), a measured bill by qty × rate.
export type Row = { kind: Kind; itemNo: string; description: string; unit: string; qty: number; rate: number; amount: number };

/** The effective line total in cents. The Amount column is authoritative when
 *  present (real bills often round or hand-enter it, so it can differ from
 *  qty × rate); fall back to qty × rate only when there is no amount. */
export function lineCents(r: Pick<Row, 'qty' | 'rate' | 'amount'>): number {
  if (r.amount > 0) return Math.round(r.amount * 100);
  return Math.round(r.qty * r.rate * 100);
}
