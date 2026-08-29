import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SubmitButton } from '@/components/ui/submit-button';
import { inputCompactClass as inputClass } from '@/components/ui/form';
import { PROJECT_ROLES, PROJECT_ROLE_LABELS, projectRolesForType } from '@datumpro/shared/access';
import type { ProjectMemberRow, AddableMember } from '@/lib/data/members';
import { updateProjectMemberRole, removeProjectMember, setProjectMemberStatus } from '../team/actions';
import { AddTeammateForm } from '../team/add-teammate-form';

const ROLE_TONE = {
  pm: 'blue',
  contractor: 'blue',
  contributor: 'green',
  client: 'amber',
  viewer: 'neutral',
} as const;

const ROLE_BLURB: Record<string, string> = {
  pm: 'Manages the project — tasks, members, schedule.',
  contractor: 'Executes tasks under an agreed commitment (cost, timeline, terms).',
  contributor: 'Does the work — updates assigned tasks, submits reports.',
  client: 'External stakeholder — sees progress and their invoices.',
  viewer: 'Read-only access to this project.',
};

export function TeamTab({
  projectId,
  members,
  addable,
  canManage,
}: {
  projectId: string;
  members: ProjectMemberRow[];
  addable: AddableMember[];
  canManage: boolean;
}) {
  return (
    <div>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Members added here see only this project. Company owners, admins and finance see every project
        automatically. Disabling a member revokes their access to this project but keeps their history.
      </p>

      <section className="space-y-2">
        {members.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No members yet.</p>
        ) : (
          members.map((m) => {
            const disabled = m.status === 'disabled';
            return (
              <Card key={m.userId} className={disabled ? 'opacity-70' : undefined}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {m.name}
                      {disabled && <Badge tone="neutral">Disabled</Badge>}
                    </p>
                    {m.email && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{m.email}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!canManage ? (
                      <Badge tone={ROLE_TONE[m.role]}>{PROJECT_ROLE_LABELS[m.role]}</Badge>
                    ) : disabled ? (
                      <>
                        <Badge tone={ROLE_TONE[m.role]}>{PROJECT_ROLE_LABELS[m.role]}</Badge>
                        <form action={setProjectMemberStatus}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="userId" value={m.userId} />
                          <input type="hidden" name="status" value="active" />
                          <SubmitButton variant="secondary" pendingText="…">Re-enable</SubmitButton>
                        </form>
                      </>
                    ) : (
                      <>
                        <form action={updateProjectMemberRole} className="flex items-center gap-2">
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="userId" value={m.userId} />
                          <select name="role" defaultValue={m.role} className={inputClass}>
                            {projectRolesForType(m.memberType).map((r) => (
                              <option key={r} value={r}>{PROJECT_ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                          <SubmitButton variant="secondary" pendingText="…">Update</SubmitButton>
                        </form>
                        <form action={setProjectMemberStatus}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="userId" value={m.userId} />
                          <input type="hidden" name="status" value="disabled" />
                          <SubmitButton variant="ghost" pendingText="…">Disable</SubmitButton>
                        </form>
                        <form action={removeProjectMember}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="userId" value={m.userId} />
                          <SubmitButton variant="ghost" pendingText="…">Remove</SubmitButton>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </section>

      {canManage && (
        <section className="mt-8">
          <Card>
            <CardTitle>Add a teammate</CardTitle>
            {addable.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                Everyone in this company is already on the project. To bring in someone new,{' '}
                <Link href="/org/members" className="text-brand-600 dark:text-brand-400 hover:underline">
                  invite them to the company
                </Link>{' '}
                first, then add them here.
              </p>
            ) : (
              <AddTeammateForm projectId={projectId} addable={addable} />
            )}

            <ul className="mt-4 space-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {PROJECT_ROLES.map((r) => (
                <li key={r}>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{PROJECT_ROLE_LABELS[r]}</span> — {ROLE_BLURB[r]}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
