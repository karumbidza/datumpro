'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { inputClass, labelClass, Req } from '@/components/ui/form';
import { scheduleTasks } from './actions';

/** PM picks the start date and runs the forward pass. Re-running is safe:
 *  started/done tasks keep their dates and anchor their successors. */
export function SchedulePanel({
  projectId,
  boqId,
  defaultStartDate,
}: {
  projectId: string;
  boqId: string;
  defaultStartDate: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(
    defaultStartDate && defaultStartDate >= today ? defaultStartDate : today,
  );

  return (
    <form
      action={scheduleTasks}
      className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="boqId" value={boqId} />
      <div>
        <label className={labelClass} htmlFor="schedule-start">
          Programme start<Req />
        </label>
        <input
          id="schedule-start"
          type="date"
          name="startDate"
          required
          min={today}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className={inputClass}
        />
      </div>
      <Button type="submit" size="sm">
        Schedule tasks
      </Button>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Independent sections start together; linked ones follow their predecessors. Working days use the
        project calendar. Started tasks keep their dates.
      </p>
    </form>
  );
}
