'use client';

import { useState } from 'react';
import { projectRolesForType, type MemberType } from '@datumpro/shared/access';
import { SubmitButton } from '@/components/ui/submit-button';
import { addProjectMember } from './actions';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

interface Addable {
  userId: string;
  name: string;
  email: string | null;
  memberType: MemberType;
}

/** Adds a company member to the project. The role options are filtered by the
 *  selected person's member type, so you can only offer roles they may hold. */
export function AddTeammateForm({ projectId, addable }: { projectId: string; addable: Addable[] }) {
  const [userId, setUserId] = useState('');
  const selected = addable.find((a) => a.userId === userId);
  const roles = selected ? projectRolesForType(selected.memberType) : [];

  return (
    <form action={addProjectMember} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="min-w-48 flex-1">
        <label className="mb-1 block text-xs font-medium">Company member</label>
        <select
          name="userId"
          required
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            Select a person…
          </option>
          {addable.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name}
              {a.email ? ` · ${a.email}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">Role</label>
        {/* key resets the default selection whenever the chosen person changes */}
        <select key={userId} name="role" disabled={!selected} className={inputClass} defaultValue={roles[0]}>
          {selected ? (
            roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))
          ) : (
            <option value="">—</option>
          )}
        </select>
      </div>
      <SubmitButton disabled={!selected} pendingText="Adding…">
        Add
      </SubmitButton>
    </form>
  );
}
