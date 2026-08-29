'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { inputClass, labelClass, Req } from '@/components/ui/form';
import { startDelivery } from './actions';

interface Props {
  tenderId: string;
  boqId: string;
  projects: { id: string; name: string }[];
  linkedProject?: { id: string; name: string } | null;
}

/** Export the awarded tender into a delivery project — either a fresh project
 *  or an existing one. Reveals an inline form matching the sibling invite forms.
 *  A BOQ already linked to a project skips the picker: the winner is assigned to
 *  that project's tasks and prices move to the winning bid (the RPC ignores the
 *  mode/name params in that case). */
export function StartDelivery({ tenderId, boqId, projects, linkedProject = null }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const hasProjects = projects.length > 0;

  if (linkedProject) {
    return (
      <form action={startDelivery}>
        <input type="hidden" name="tenderId" value={tenderId} />
        <input type="hidden" name="boqId" value={boqId} />
        <input type="hidden" name="mode" value="new" />
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">
          This bill belongs to <span className="font-medium">{linkedProject.name}</span>. The winner is
          assigned to its tasks and prices move to the winning bid.
        </p>
        <Button type="submit" size="sm">
          Assign winner to {linkedProject.name} →
        </Button>
      </form>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Start delivery →
      </Button>
    );
  }

  return (
    <form
      action={startDelivery}
      className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/40"
    >
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="boqId" value={boqId} />
      <input type="hidden" name="mode" value={mode} />

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Start delivery:</span>
        <button
          type="button"
          onClick={() => setMode('new')}
          className={`rounded px-2.5 py-1 text-sm transition ${
            mode === 'new'
              ? 'bg-brand-600 text-white'
              : 'border border-zinc-300 text-zinc-600 hover:border-brand-400 dark:border-zinc-600 dark:text-zinc-300'
          }`}
        >
          New project
        </button>
        {hasProjects && (
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={`rounded px-2.5 py-1 text-sm transition ${
              mode === 'existing'
                ? 'bg-brand-600 text-white'
                : 'border border-zinc-300 text-zinc-600 hover:border-brand-400 dark:border-zinc-600 dark:text-zinc-300'
            }`}
          >
            Existing project
          </button>
        )}
      </div>

      {mode === 'new' || !hasProjects ? (
        <div>
          <label className={labelClass} htmlFor="projectName">
            Project name<Req />
          </label>
          <input
            id="projectName"
            name="projectName"
            required
            className={inputClass}
          />
        </div>
      ) : (
        <div>
          <label className={labelClass} htmlFor="projectId">
            Project
          </label>
          <select id="projectId" name="projectId" className={inputClass} defaultValue={projects[0]?.id}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Create &amp; assign
        </Button>
      </div>
    </form>
  );
}
