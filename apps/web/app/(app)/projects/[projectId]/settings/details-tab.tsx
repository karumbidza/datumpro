import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { inputClass, labelClass, hintClass } from '@/components/ui/form';
import {
  CONSTRUCTION_TYPES, CONSTRUCTION_TYPE_LABELS, TASK_PRIORITIES, TASK_PRIORITY_LABELS,
} from '@datumpro/shared/domain';
import type { ProjectEditRow } from '@/lib/data/projects';
import type { ClientOption } from '@/lib/data/clients';
import { updateProjectDetails } from './actions';

export function DetailsTab({
  project,
  clients,
}: {
  project: ProjectEditRow;
  clients: ClientOption[];
}) {
  return (
    <Card>
      <CardTitle>Project details</CardTitle>
      <form action={updateProjectDetails} className="mt-4 space-y-4">
        <input type="hidden" name="projectId" value={project.id} />

        <div>
          <label htmlFor="name" className={labelClass}>Project name</label>
          <input id="name" name="name" required defaultValue={project.name} className={inputClass} />
          {project.code && <p className={hintClass}>Code {project.code} — assigned automatically, can’t be changed.</p>}
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>Description <span className="font-normal text-zinc-400">(optional)</span></label>
          <textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={project.description ?? ''} className={inputClass} />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="priority" className={labelClass}>Priority</label>
            <select id="priority" name="priority" defaultValue={project.priority} className={inputClass}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="constructionType" className={labelClass}>Construction type</label>
            <select id="constructionType" name="constructionType" defaultValue={project.construction_type ?? ''} className={inputClass}>
              <option value="" disabled>Select…</option>
              {CONSTRUCTION_TYPES.map((t) => (
                <option key={t} value={t}>{CONSTRUCTION_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="clientId" className={labelClass}>Client</label>
          <select id="clientId" name="clientId" defaultValue={project.client_id ?? ''} className={inputClass}>
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="startDate" className={labelClass}>Start date</label>
            <input id="startDate" name="startDate" type="date" defaultValue={project.start_date ?? ''} className={inputClass} />
          </div>
          <div className="flex-1">
            <label htmlFor="durationWorkingDays" className={labelClass}>Duration (working days)</label>
            <input
              id="durationWorkingDays"
              name="durationWorkingDays"
              type="number"
              min={1}
              inputMode="numeric"
              defaultValue={project.duration_working_days ?? ''}
              className={inputClass}
            />
            <p className={hintClass}>
              {project.end_date ? `Ends ${project.end_date} — recalculated on save from the work calendar.` : 'End date is calculated from this and the work calendar.'}
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <SubmitButton pendingText="Saving…">Save details</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
