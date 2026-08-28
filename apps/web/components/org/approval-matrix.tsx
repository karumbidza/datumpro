import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { setApprovalMatrix } from '@/app/(app)/org/actions';
import type { ApprovalMatrixRow } from '@/lib/data/approvals';

const ENTITIES: { key: string; label: string }[] = [
  { key: 'task_plan', label: 'Task plan' },
  { key: 'task_variation', label: 'Variation' },
  { key: 'extension', label: 'Extension' },
  { key: 'payment', label: 'Payment' },
  { key: 'request', label: 'Request' },
];
const ROLE_OPTIONS = ['none', 'pm', 'finance', 'admin', 'viewer'] as const;
const ROLE_LABEL: Record<string, string> = { none: 'None', pm: 'Another PM', finance: 'Finance', admin: 'Admin', viewer: 'Viewer' };
const selectClass = 'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

function RoleSelect({ name, value }: { name: string; value: string }) {
  return (
    <select name={name} defaultValue={value} className={selectClass}>
      {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </select>
  );
}

export function ApprovalMatrix({ orgId, matrix }: { orgId: string; matrix: ApprovalMatrixRow[] }) {
  const byType = new Map(matrix.map((m) => [m.entityType, m]));
  return (
    <Card>
      <CardTitle>Approval matrix</CardTitle>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Everything that needs sign-off goes to the <span className="font-medium text-zinc-700 dark:text-zinc-300">project
        manager first</span>. Add up to two more approvers (by role) per type, and an optional amount above which the extra
        approvals kick in.
      </p>
      <form action={setApprovalMatrix} className="mt-3 overflow-x-auto">
        <input type="hidden" name="orgId" value={orgId} />
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th className="py-1 pr-3 font-medium">Needs sign-off</th>
              <th className="py-1 pr-3 font-medium">1st</th>
              <th className="py-1 pr-3 font-medium">2nd</th>
              <th className="py-1 pr-3 font-medium">3rd</th>
              <th className="py-1 font-medium">Threshold ($)</th>
            </tr>
          </thead>
          <tbody>
            {ENTITIES.map(({ key, label }) => {
              const row = byType.get(key);
              const step2 = row?.extraRoles[0] ?? 'none';
              const step3 = row?.extraRoles[1] ?? 'none';
              const threshold = row && row.minAmountCents > 0 ? Math.round(row.minAmountCents / 100) : '';
              return (
                <tr key={key} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3 font-medium text-zinc-800 dark:text-zinc-200">{label}</td>
                  <td className="py-2 pr-3 text-xs text-zinc-500 dark:text-zinc-400">PM</td>
                  <td className="py-2 pr-3"><RoleSelect name={`${key}_step2`} value={step2} /></td>
                  <td className="py-2 pr-3"><RoleSelect name={`${key}_step3`} value={step3} /></td>
                  <td className="py-2">
                    <input
                      type="number" min={0} step={100} name={`${key}_threshold`} defaultValue={threshold}
                      placeholder="0"
                      className={`w-24 ${selectClass}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3">
          <Button type="submit">Save matrix</Button>
        </div>
      </form>
    </Card>
  );
}
