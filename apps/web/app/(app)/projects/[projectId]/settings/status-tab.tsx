import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { inputClass, labelClass, hintClass } from '@/components/ui/form';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@datumpro/shared/domain';
import type { ProjectEditRow } from '@/lib/data/projects';
import { updateProjectStatus, updateSiteLocation } from './actions';

export function StatusTab({ project }: { project: ProjectEditRow }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Project status</CardTitle>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Move the project through its lifecycle — put it on hold, mark it complete, or archive it.
        </p>
        <form action={updateProjectStatus} className="mt-4 flex items-end gap-3">
          <input type="hidden" name="projectId" value={project.id} />
          <div className="flex-1 sm:max-w-xs">
            <label htmlFor="status" className={labelClass}>Status</label>
            <select id="status" name="status" defaultValue={project.status} className={inputClass}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <SubmitButton pendingText="Saving…">Update status</SubmitButton>
        </form>
      </Card>

      <Card>
        <CardTitle>Site location</CardTitle>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The site’s coordinates — used for site reports and to complete the Site location setup item.
          Leave both blank to clear.
        </p>
        <form action={updateSiteLocation} className="mt-4 space-y-4">
          <input type="hidden" name="projectId" value={project.id} />
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex-1">
              <label htmlFor="latitude" className={labelClass}>Latitude</label>
              <input
                id="latitude"
                name="latitude"
                type="number"
                step="any"
                inputMode="decimal"
                defaultValue={project.latitude ?? ''}
                placeholder="e.g. -17.8252"
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label htmlFor="longitude" className={labelClass}>Longitude</label>
              <input
                id="longitude"
                name="longitude"
                type="number"
                step="any"
                inputMode="decimal"
                defaultValue={project.longitude ?? ''}
                placeholder="e.g. 31.0335"
                className={inputClass}
              />
            </div>
          </div>
          <p className={hintClass}>Decimal degrees (WGS-84).</p>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save location</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
