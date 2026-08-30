'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { ImageIcon, MapPin, Users, Plus } from '@/components/icons';
import type { SiteDiaryEntry, DiaryPhoto } from '@/lib/data/site-diary-types';
import {
  saveSiteDiaryEntry,
  recordSiteDiaryPhoto,
  deleteSiteDiaryPhoto,
  deleteSiteDiaryEntry,
} from '@/app/(app)/projects/[projectId]/diary/actions';

const BUCKET = 'project-media';

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-400 dark:text-zinc-500';

function Composer({
  projectId,
  entry,
  onDone,
  onCancel,
}: {
  projectId: string;
  entry?: SiteDiaryEntry;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? todayLocal());
  const [weather, setWeather] = useState(entry?.weather ?? '');
  const [temperature, setTemperature] = useState(entry?.temperature != null ? String(entry.temperature) : '');
  const [labourCount, setLabourCount] = useState(entry?.labourCount != null ? String(entry.labourCount) : '');
  const [plant, setPlant] = useState(entry?.plant ?? '');
  const [deliveries, setDeliveries] = useState(entry?.deliveries ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('entryDate', entryDate);
      fd.set('weather', weather.trim());
      fd.set('temperature', temperature.trim());
      fd.set('labourCount', labourCount.trim());
      fd.set('plant', plant.trim());
      fd.set('deliveries', deliveries.trim());
      fd.set('notes', notes.trim());
      const res = await saveSiteDiaryEntry(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not save');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Date</span>
          {/* Locked once created — a day's entry stays that day. */}
          <input
            type="date"
            value={entryDate}
            max={todayLocal()}
            onChange={(e) => setEntryDate(e.target.value)}
            disabled={!!entry}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Weather</span>
          <input
            value={weather}
            onChange={(e) => setWeather(e.target.value)}
            placeholder="e.g. Overcast, showers pm"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Temperature (°C)</span>
          <input
            type="number"
            inputMode="numeric"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            placeholder="18"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Labour on site</span>
          <input
            type="number"
            inputMode="numeric"
            value={labourCount}
            onChange={(e) => setLabourCount(e.target.value)}
            placeholder="12"
            className={inputClass}
          />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>Plant &amp; equipment</span>
        <input
          value={plant}
          onChange={(e) => setPlant(e.target.value)}
          placeholder="e.g. 1 excavator, 2 mixers, tower crane"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={fieldLabel}>Deliveries</span>
        <textarea
          value={deliveries}
          onChange={(e) => setDeliveries(e.target.value)}
          rows={2}
          placeholder="Materials received on site today…"
          className={`${inputClass} resize-y`}
        />
      </label>
      <label className="block">
        <span className={fieldLabel}>Work done / notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="What progressed today, issues, instructions given…"
          className={`${inputClass} resize-y`}
        />
      </label>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : entry ? 'Save' : 'Log entry'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function PhotoUploader({
  entryId,
  projectId,
  orgId,
}: {
  entryId: string;
  projectId: string;
  orgId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
      // Segment [2] is the project → existing project-media storage policy authorises it.
      const path = `${orgId}/${projectId}/diary/${entryId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const fd = new FormData();
      fd.set('entryId', entryId);
      fd.set('projectId', projectId);
      fd.set('storagePath', path);
      const res = await recordSiteDiaryPhoto(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not attach photo');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <label
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 ${
          busy ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <input type="file" accept="image/*" className="hidden" onChange={onChange} disabled={busy} />
        <ImageIcon size={14} />
        {busy ? 'Uploading…' : 'Add photo'}
      </label>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function Stat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {icon}
      {children}
    </span>
  );
}

function PhotoGrid({
  photos,
  projectId,
  canEdit,
}: {
  photos: DiaryPhoto[];
  projectId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  if (photos.length === 0) return null;
  async function remove(photoId: string) {
    const fd = new FormData();
    fd.set('photoId', photoId);
    fd.set('projectId', projectId);
    await deleteSiteDiaryPhoto(fd);
    router.refresh();
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {photos.map((p) => (
        <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption ?? 'Site photo'} className="h-full w-full object-cover" />
            </a>
          ) : (
            <div className="grid h-full w-full place-items-center text-zinc-400">
              <ImageIcon size={20} />
            </div>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => remove(p.id)}
              aria-label="Remove photo"
              className="absolute right-1 top-1 hidden h-6 w-6 place-items-center rounded-full bg-black/60 text-white group-hover:grid"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function EntryCard({
  entry,
  projectId,
  orgId,
  canModerate,
  currentUserId,
}: {
  entry: SiteDiaryEntry;
  projectId: string;
  orgId: string;
  canModerate: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const canEdit = canModerate || entry.createdBy === currentUserId;
  const isToday = entry.entryDate === todayLocal();

  async function remove() {
    const fd = new FormData();
    fd.set('id', entry.id);
    fd.set('projectId', projectId);
    await deleteSiteDiaryEntry(fd);
    router.refresh();
  }

  if (editing) {
    return (
      <Composer
        projectId={projectId}
        entry={entry}
        onDone={() => {
          setEditing(false);
          router.refresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{dayLabel(entry.entryDate)}</h3>
            {isToday && (
              <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                Today
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Logged by {entry.createdByName ?? 'Member'}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-3 text-[11px]">
            <button type="button" onClick={() => setEditing(true)} className="text-zinc-500 hover:underline dark:text-zinc-400">
              Edit
            </button>
            <button type="button" onClick={remove} className="text-zinc-400 hover:text-red-500 hover:underline">
              Delete
            </button>
          </div>
        )}
      </div>

      {(entry.weather || entry.temperature != null || entry.labourCount != null) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {entry.weather && <Stat icon={<span aria-hidden>☁︎</span>}>{entry.weather}</Stat>}
          {entry.temperature != null && <Stat icon={<span aria-hidden>🌡</span>}>{entry.temperature}°C</Stat>}
          {entry.labourCount != null && (
            <Stat icon={<Users size={13} />}>
              {entry.labourCount} on site
            </Stat>
          )}
        </div>
      )}

      <dl className="mt-3 space-y-2">
        {entry.plant && (
          <div>
            <dt className={fieldLabel}>Plant &amp; equipment</dt>
            <dd className="text-sm text-zinc-700 dark:text-zinc-200">{entry.plant}</dd>
          </div>
        )}
        {entry.deliveries && (
          <div>
            <dt className={fieldLabel}>Deliveries</dt>
            <dd className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{entry.deliveries}</dd>
          </div>
        )}
        {entry.notes && (
          <div>
            <dt className={fieldLabel}>Work done / notes</dt>
            <dd className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{entry.notes}</dd>
          </div>
        )}
      </dl>

      <div className="mt-3 space-y-2">
        <PhotoGrid photos={entry.photos} projectId={projectId} canEdit={canEdit} />
        {canEdit && <PhotoUploader entryId={entry.id} projectId={projectId} orgId={orgId} />}
      </div>
    </div>
  );
}

/** The Site Diary surface: a day-by-day site record with weather, labour, plant,
 *  deliveries, notes and photos. Any member can log; the author or a manager edits. */
export function SiteDiary({
  projectId,
  orgId,
  entries,
  canModerate,
  currentUserId,
}: {
  projectId: string;
  orgId: string;
  entries: SiteDiaryEntry[];
  canModerate: boolean;
  currentUserId: string;
}) {
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const hasToday = entries.some((e) => e.entryDate === todayLocal());

  return (
    <div className="space-y-4">
      {adding ? (
        <Composer
          projectId={projectId}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button size="sm" onClick={() => setAdding(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={15} />
            {hasToday ? 'Log an entry' : "Log today's entry"}
          </span>
        </Button>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
          <MapPin size={20} className="mx-auto text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            No diary entries yet. Log the first one — the day&apos;s weather, who was on site, what got done, and a few
            photos.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              projectId={projectId}
              orgId={orgId}
              canModerate={canModerate}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
