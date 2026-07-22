import { Card, CardTitle } from '@/components/ui/card';
import { MapPin } from '@/components/icons';
import { MediaUploader } from '@/components/task/media-uploader';
import { removeTaskMedia } from '@/app/(app)/projects/[projectId]/tasks/actions';
import type { TaskMediaRow } from '@/lib/data/quotes';

interface Props {
  taskId: string;
  projectId: string;
  orgId: string;
  media: TaskMediaRow[];
  canUpload: boolean;
  canManage: boolean;
}

export function CompletionEvidence({ taskId, projectId, orgId, media, canUpload, canManage }: Props) {
  return (
    <Card className="mt-6">
      <CardTitle>Completion evidence</CardTitle>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Photos, videos or documents (PDF, Excel) of the work — e.g. a licence or certificate. Optional.
      </p>

      {media.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No evidence uploaded yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
              <div className="relative">
                {m.kind === 'photo' && m.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.caption ?? 'Completion photo'} className="h-28 w-full object-cover" />
                ) : (
                  <a
                    href={m.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-28 w-full items-center justify-center bg-zinc-50 text-xs text-brand-500 underline dark:bg-zinc-900"
                  >
                    {m.kind === 'video' ? '▶ View video' : 'View file'}
                  </a>
                )}
                {m.gpsLat != null && m.gpsLng != null && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${m.gpsLat},${m.gpsLng}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`Taken at ${m.gpsLat.toFixed(5)}, ${m.gpsLng.toFixed(5)} — open in Maps`}
                    className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80"
                  >
                    <MapPin size={11} /> Located
                  </a>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="truncate text-[10px] text-zinc-400">{m.uploaderName ?? ''}</span>
                {canManage && (
                  <form action={removeTaskMedia}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="mediaId" value={m.id} />
                    <button type="submit" className="text-[10px] text-zinc-400 hover:text-red-500">
                      Remove
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="mt-4">
          <MediaUploader
            taskId={taskId}
            projectId={projectId}
            orgId={orgId}
            purpose="completion"
            accept="image/*,video/*,.pdf,.xls,.xlsx,.csv"
            label="Attach photo, video or document"
          />
        </div>
      )}
    </Card>
  );
}
