'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import type { ProjectBoqSummary, UnlinkedBoqOption } from '@/lib/data/boq';
import { attachBoq, createProjectBoq, cloneBoqIntoProject, generateBoqTasks, unlinkBoq } from './actions';

export function BoqTabControls({
  projectId,
  boq,
  unlinked,
  cloneable,
}: {
  projectId: string;
  boq: ProjectBoqSummary | null;
  unlinked: UnlinkedBoqOption[];
  cloneable: UnlinkedBoqOption[];
}) {
  const [boqId, setBoqId] = useState('');
  const [cloneId, setCloneId] = useState('');

  if (boq === null) {
    return (
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <form action={createProjectBoq}>
          <input type="hidden" name="projectId" value={projectId} />
          <Button type="submit" size="sm">
            Create BOQ
          </Button>
        </form>

        {cloneable.length > 0 && (
          <form action={cloneBoqIntoProject} className="flex items-end gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <select
              name="sourceBoqId"
              required
              value={cloneId}
              onChange={(e) => setCloneId(e.target.value)}
              className={inputClass}
            >
              <option value="">Clone another project’s bill…</option>
              {cloneable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.itemCount} items
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="secondary" disabled={!cloneId}>
              Clone
            </Button>
          </form>
        )}

        {unlinked.length > 0 && (
          <form action={attachBoq} className="flex items-end gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <select
              name="boqId"
              required
              value={boqId}
              onChange={(e) => setBoqId(e.target.value)}
              className={inputClass}
            >
              <option value="">Attach unlinked bill…</option>
              {unlinked.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.itemCount} items
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="secondary" disabled={!boqId}>
              Attach
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {!boq.tasksGenerated && (
        <form action={generateBoqTasks}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="boqId" value={boq.id} />
          <Button type="submit" size="sm">
            Generate tasks
          </Button>
        </form>
      )}
      <form action={unlinkBoq}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="boqId" value={boq.id} />
        <Button type="submit" size="sm" variant="secondary">
          Unlink
        </Button>
      </form>
    </div>
  );
}
