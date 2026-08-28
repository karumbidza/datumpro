'use client';

import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { Badge } from '@/components/ui/badge';
import { INVITABLE_MEMBER_TYPES, MEMBER_TYPE_META, projectRolesForType, type MemberType } from '@datumpro/shared/access';
import {
  updateOrgMemberRole,
  removeOrgMember,
  assignMemberToProject,
  deactivateOrgMember,
  reactivateOrgMember,
  sendMemberPasswordReset,
} from '@/app/(app)/org/members/actions';
import { MemberDocuments } from '@/components/org/member-documents';
import type { ContractorDocRow } from '@/lib/data/contractor-documents';

const inputClass =
  'rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-zinc-800';

const typeTone = (t: MemberType): 'amber' | 'blue' | 'neutral' =>
  t === 'owner' ? 'amber' : t === 'admin' || t === 'pm' ? 'blue' : 'neutral';

interface Member {
  userId: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string;
  memberType: MemberType;
  status: 'active' | 'disabled';
}

export function MembersRoster({
  orgId,
  members,
  projects,
  meId,
  isAdmin,
  docsByContractor = new Map(),
  canReviewDocs = false,
}: {
  orgId: string;
  members: Member[];
  projects: { id: string; name: string }[];
  meId: string;
  isAdmin: boolean;
  docsByContractor?: Map<string, ContractorDocRow[]>;
  canReviewDocs?: boolean;
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
                  {m.company && <span className="font-normal text-zinc-500 dark:text-zinc-400"> · {m.company}</span>}
                  {isSelf && <span className="text-zinc-400 dark:text-zinc-500"> · you</span>}
                </p>
                {m.email && m.email !== m.name && (
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{m.email}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {editable && !disabled ? (
                  <form action={updateOrgMemberRole}>
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <select
                      name="memberType"
                      defaultValue={m.memberType}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className={inputClass}
                    >
                      {INVITABLE_MEMBER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {MEMBER_TYPE_META[t].label}
                        </option>
                      ))}
                    </select>
                  </form>
                ) : (
                  <Badge tone={typeTone(m.memberType)}>{MEMBER_TYPE_META[m.memberType].label}</Badge>
                )}

                {['owner', 'admin', 'pm'].includes(m.role) && (
                  <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                    can approve
                  </span>
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

                {editable && (
                  <form action={sendMemberPasswordReset}>
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <SubmitButton variant="ghost" pendingText="Sending…">
                      Reset password
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>

            {isAdmin && !disabled && projects.length > 0 && (
              <details className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                <summary className="cursor-pointer text-xs text-brand-600 dark:text-brand-400 hover:underline">
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
                  <select
                    name="projectRole"
                    defaultValue={projectRolesForType(m.memberType)[0]}
                    className={inputClass}
                  >
                    {projectRolesForType(m.memberType).map((r) => (
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

            {m.memberType === 'contractor' && (
              <div className="mt-2 w-full border-t border-zinc-100 pt-2 dark:border-zinc-800">
                <MemberDocuments docs={docsByContractor.get(m.userId) ?? []} canReview={canReviewDocs} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
