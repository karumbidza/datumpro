/** Format integer minor units (cents) in a given ISO-4217 currency. Whole-unit by
 *  default (BOQ totals are large). Falls back to `CODE 1,234` for currencies a
 *  runtime's Intl doesn't know (e.g. ZWG on older engines). Safe on server + client. */
export function fmtMoney(cents: number, currency = 'USD', fractionDigits = 0): string {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })}`;
  }
}
