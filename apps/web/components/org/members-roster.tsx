'use client';

import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { Badge } from '@/components/ui/badge';
import { ORG_ROLES, PROJECT_ROLES } from '@datumpro/shared/access';
import {
  updateOrgMemberRole,
  removeOrgMember,
  assignMemberToProject,
  deactivateOrgMember,
  reactivateOrgMember,
} from '@/app/(app)/org/members/actions';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

// Owner is transferred, not assigned — keep it out of the editable options.
const ASSIGNABLE_ORG_ROLES = ORG_ROLES.filter((r) => r !== 'owner');

interface Member {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  status: 'active' | 'disabled';
}

export function MembersRoster({
  orgId,
  members,
  projects,
  meId,
  isAdmin,
}: {
  orgId: string;
  members: Member[];
  projects: { id: string; name: string }[];
  meId: string;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-2">
      {members.map((m) => {
        const isSelf = m.userId === meId;
        const editable = isAdmin && !isSelf && m.role !== 'owner';
        const disabled = m.status === 'disabled';
        return (
          <Card key={m.userId} className={disabled ? 'opacity-60' : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {m.name}
                  {isSelf && <span className="text-zinc-400"> · you</span>}
                </p>
                {m.email && <p className="truncate text-xs text-zinc-500">{m.email}</p>}
              </div>

              <div className="flex items-center gap-2">
                {editable && !disabled ? (
                  <form action={updateOrgMemberRole}>
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className={inputClass}
                    >
                      {ASSIGNABLE_ORG_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </form>
                ) : (
                  <Badge tone={m.role === 'owner' ? 'amber' : m.role === 'admin' ? 'blue' : 'neutral'}>
                    {m.role}
                  </Badge>
                )}

                {disabled && <Badge tone="neutral">disabled</Badge>}

                {editable && !disabled && (
                  <>
                    <form action={deactivateOrgMember}>
                      <input type="hidden" name="orgId" value={orgId} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <SubmitButton variant="ghost" pendingText="…">
                        Deactivate
                      </SubmitButton>
                    </form>
                    <form
                      action={removeOrgMember}
                      onSubmit={(e) => {
                        if (
                          !window.confirm(
                            'Remove this member permanently? This deletes their membership and history. Consider Deactivate instead.',
                          )
                        )
                          e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="orgId" value={orgId} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <SubmitButton variant="ghost" pendingText="…">
                        Remove
                      </SubmitButton>
                    </form>
                  </>
                )}

                {editable && disabled && (
                  <form action={reactivateOrgMember}>
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <SubmitButton variant="secondary" pendingText="…">
                      Reactivate
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>

            {isAdmin && !disabled && projects.length > 0 && (
              <details className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                <summary className="cursor-pointer text-xs text-brand-600 hover:underline">
                  Assign to a project
                </summary>
                <form action={assignMemberToProject} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="userId" value={m.userId} />
                  <select name="projectId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Project…
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select name="projectRole" defaultValue="contractor" className={inputClass}>
                    {PROJECT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <SubmitButton variant="secondary" pendingText="Assigning…">
                    Assign
                  </SubmitButton>
                </form>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
