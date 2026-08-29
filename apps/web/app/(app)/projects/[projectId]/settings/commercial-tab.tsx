import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { inputClass, labelClass, hintClass } from '@/components/ui/form';
import { CURRENCIES } from '@datumpro/shared/domain';
import type { ProjectEditRow } from '@/lib/data/projects';
import { updateCommercialTerms } from './actions';

export function CommercialTab({ project }: { project: ProjectEditRow }) {
  const contractMajor = (project.contract_value_cents ?? 0) / 100;
  return (
    <Card>
      <CardTitle>Commercial terms</CardTitle>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        The contract value and currency set the commercial baseline; retention and payment days drive
        the payment-terms setup item.
      </p>
      <form action={updateCommercialTerms} className="mt-4 space-y-4">
        <input type="hidden" name="projectId" value={project.id} />

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="w-32">
            <label htmlFor="currency" className={labelClass}>Currency</label>
            <select id="currency" name="currency" defaultValue={project.currency} className={inputClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="contractValue" className={labelClass}>Contract value</label>
            <input
              id="contractValue"
              name="contractValue"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={contractMajor ? String(contractMajor) : ''}
              placeholder="0.00"
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="retentionPct" className={labelClass}>Retention %</label>
            <input
              id="retentionPct"
              name="retentionPct"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              defaultValue={project.retention_pct ?? ''}
              placeholder="e.g. 10"
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="paymentTermsDays" className={labelClass}>Payment terms (days)</label>
            <input
              id="paymentTermsDays"
              name="paymentTermsDays"
              type="number"
              min={0}
              max={365}
              inputMode="numeric"
              defaultValue={project.payment_terms_days ?? ''}
              placeholder="e.g. 30"
              className={inputClass}
            />
          </div>
        </div>
        <p className={hintClass}>Set both retention and payment days to complete the Payment terms item.</p>

        <div className="flex justify-end">
          <SubmitButton pendingText="Saving…">Save commercial terms</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
