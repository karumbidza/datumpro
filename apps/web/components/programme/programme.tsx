'use client';

import { useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { AlertTriangle, GanttChart } from '@/components/icons';
import { parseDate, startOfDay, addDays, differenceInDays, formatDayMonth } from '@/lib/date';
import type { TaskStatus, DependencyType } from '@datumpro/shared/domain';
import type { ProgrammeData, ProgrammeTask } from '@/lib/data/programme-types';
import {
  rescheduleTask,
  createDependency,
  deleteDependency,
  updateDependency,
  setAutoSchedule,
  reorderProgramme,
  setBaseline,
} from '@/app/(app)/projects/[projectId]/programme/actions';

const DEP_OPTIONS: { value: DependencyType; label: string }[] = [
  { value: 'fs', label: 'Finish → Start' },
  { value: 'ss', label: 'Start → Start' },
  { value: 'ff', label: 'Finish → Finish' },
  { value: 'sf', label: 'Start → Finish' },
];
function depTag(type: DependencyType, lag: number): string {
  const base = type.toUpperCase();
  return lag > 0 ? `${base}+${lag}` : lag < 0 ? `${base}${lag}` : base;
}

const DAY_W = 26; // px per day
const ROW_H = 34; // px per task row
const LABEL_W = 200; // left label column
const AXIS_H = 34; // date axis header
const PAD_DAYS = 3; // breathing room either side of the range

const STATUS_BAR: Record<TaskStatus, string> = {
  todo: 'bg-zinc-400 dark:bg-zinc-500',
  in_progress: 'bg-brand-500',
  submitted: 'bg-amber-400 dark:bg-amber-500',
  blocked: 'bg-orange-500',
  done: 'bg-emerald-500',
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  submitted: 'In review',
  blocked: 'Blocked',
  done: 'Done',
};

function fmt(iso: string): string {
  const d = parseDate(iso);
  return d ? formatDayMonth(d) : iso;
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
// UTC-based arithmetic on YYYY-MM-DD, so day shifts don't drift across timezones.
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDaysIso(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

type DragSession = {
  mode: 'move' | 'resize-start' | 'resize-end' | 'link';
  taskId: string;
  origStart: string;
  origEnd: string;
  fromEdge?: 'start' | 'finish';
};

function RescheduleForm({
  task,
  projectId,
  onDone,
  onCancel,
}: {
  task: ProgrammeTask;
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(task.startIso);
  const [end, setEnd] = useState(task.endIso);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (end < start) return setError('The end date can’t be before the start.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('taskId', task.id);
      fd.set('projectId', projectId);
      fd.set('plannedStartDate', start);
      fd.set('plannedEndDate', end);
      const res = await rescheduleTask(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not reschedule');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reschedule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div>
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-400">Start</span>
        <input type="date" value={start} min={todayIso()} onChange={(e) => setStart(e.target.value)} className={inputClass} />
      </div>
      <div>
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-400">End</span>
        <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
      </div>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? 'Saving…' : 'Reschedule'}
      </Button>
      <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
        Cancel
      </button>
      {error && <p className="w-full text-xs text-red-500">{error}</p>}
    </form>
  );
}

/** Edit an existing dependency: change its relationship type / lag, or remove it. */
function LinkEditor({
  projectId,
  predecessorId,
  successorId,
  predTitle,
  succTitle,
  initialType,
  initialLag,
  onDone,
  onCancel,
}: {
  projectId: string;
  predecessorId: string;
  successorId: string;
  predTitle: string;
  succTitle: string;
  initialType: DependencyType;
  initialLag: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<DependencyType>(initialType);
  const [lag, setLag] = useState(String(initialLag));
  const [busy, setBusy] = useState(false);

  async function run(action: typeof updateDependency | typeof deleteDependency, withFields: boolean) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('predecessorId', predecessorId);
      fd.set('successorId', successorId);
      if (withFields) {
        fd.set('type', type);
        fd.set('lagDays', String(Number.parseInt(lag, 10) || 0));
      }
      await action(fd);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-56 text-xs">
      <p className="mb-2 text-zinc-500 dark:text-zinc-400">
        <span className="text-zinc-700 dark:text-zinc-200">{predTitle}</span>
        {' → '}
        <span className="text-zinc-700 dark:text-zinc-200">{succTitle}</span>
      </p>
      <label className="mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Relationship</label>
      <select value={type} onChange={(e) => setType(e.target.value as DependencyType)} className={`${inputClass} mb-2`}>
        {DEP_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label className="mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Lag (days)</label>
      <input type="number" value={lag} onChange={(e) => setLag(e.target.value)} className={`${inputClass} mb-2`} />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => run(updateDependency, true)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(deleteDependency, false)}
          className="text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
        >
          Remove
        </button>
        <button type="button" onClick={onCancel} className="text-zinc-500 hover:underline dark:text-zinc-400">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The project programme: a Gantt timeline with a critical-path highlight, float,
 *  dependency arrows, a today marker and projected-vs-baseline finish. Managers can
 *  drag a bar to move it, drag its edges to resize, and drag between bars to link
 *  them. Click a link to change its type (FS/SS/FF/SF) or lag. With auto-schedule
 *  on, dependents cascade forward. */
export function Programme({
  projectId,
  data,
  canModerate,
}: {
  projectId: string;
  data: ProgrammeData;
  canModerate: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ taskId: string; startIso: string; endIso: string } | null>(null);
  const [link, setLink] = useState<{ fromId: string; fromEdge: 'start' | 'finish'; x: number; y: number; overId: string | null } | null>(null);
  const [reorder, setReorder] = useState<{ taskId: string; overIndex: number } | null>(null);
  const [linkMenu, setLinkMenu] = useState<{ predecessorId: string; successorId: string; type: DependencyType; lag: number; x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBaseline, setShowBaseline] = useState(true);
  const rowsRef = useRef<HTMLDivElement>(null);

  const geom = useMemo(() => {
    if (!data.rangeStartIso || !data.rangeEndIso) return null;
    const rangeStart = startOfDay(parseDate(data.rangeStartIso)!);
    const start = addDays(rangeStart, -PAD_DAYS);
    const rangeEnd = startOfDay(parseDate(data.rangeEndIso)!);
    const totalDays = differenceInDays(rangeEnd, start) + 1 + PAD_DAYS;
    const width = totalDays * DAY_W;
    const offset = (iso: string) => {
      const d = parseDate(iso);
      return d ? differenceInDays(startOfDay(d), start) : 0;
    };
    const ticks: { x: number; label: string }[] = [];
    for (let i = 0; i <= totalDays; i += 7) {
      ticks.push({ x: i * DAY_W, label: formatDayMonth(addDays(start, i)) });
    }
    const today = todayIso();
    const todayX = parseDate(today) && parseDate(today)! >= start ? offset(today) * DAY_W : null;
    const withinRange = todayX != null && todayX <= width;
    return { start, totalDays, width, offset, ticks, todayX: withinRange ? todayX : null };
  }, [data.rangeStartIso, data.rangeEndIso]);

  const rowIndexById = useMemo(() => {
    const m = new Map<string, number>();
    data.tasks.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [data.tasks]);
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    data.tasks.forEach((t) => m.set(t.id, t.title));
    return m;
  }, [data.tasks]);

  const selectedTask = data.tasks.find((t) => t.id === selected) ?? null;

  // The window to draw for a task: its previewed window while it's being dragged.
  const winOf = (t: ProgrammeTask): { startIso: string; endIso: string } =>
    preview && preview.taskId === t.id ? { startIso: preview.startIso, endIso: preview.endIso } : { startIso: t.startIso, endIso: t.endIso };

  function flash(message: string) {
    setError(message);
    window.setTimeout(() => setError((cur) => (cur === message ? null : cur)), 4000);
  }

  async function runReschedule(taskId: string, start: string, end: string) {
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('projectId', projectId);
    fd.set('plannedStartDate', start);
    fd.set('plannedEndDate', end);
    const res = await rescheduleTask(fd);
    if (!res.ok) flash(res.error ?? 'Could not reschedule');
    router.refresh();
  }
  async function runLink(predecessorId: string, successorId: string) {
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('predecessorId', predecessorId);
    fd.set('successorId', successorId);
    const res = await createDependency(fd);
    if (!res.ok) flash(res.error ?? 'Could not link the tasks');
    router.refresh();
  }
  async function toggleAuto() {
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('enabled', String(!data.autoSchedule));
    const res = await setAutoSchedule(fd);
    if (!res.ok) flash(res.error ?? 'Could not change auto-schedule');
    router.refresh();
  }
  async function runBaseline() {
    if (data.baselinedAt && !window.confirm('Re-baseline to the current plan? This replaces the saved baseline.')) return;
    const fd = new FormData();
    fd.set('projectId', projectId);
    const res = await setBaseline(fd);
    if (!res.ok) flash(res.error ?? 'Could not set the baseline');
    router.refresh();
  }

  function indexAtClientY(clientY: number): number | null {
    const rows = rowsRef.current;
    if (!rows) return null;
    const rect = rows.getBoundingClientRect();
    const idx = Math.floor((clientY - rect.top) / ROW_H);
    return Math.max(0, Math.min(data.tasks.length - 1, idx));
  }
  function taskAtClientY(clientY: number): ProgrammeTask | null {
    const idx = indexAtClientY(clientY);
    return idx == null ? null : data.tasks[idx]!;
  }

  async function runReorder(taskId: string, toIndex: number) {
    const ids = data.tasks.map((t) => t.id);
    const from = ids.indexOf(taskId);
    if (from === -1 || from === toIndex) return;
    ids.splice(from, 1);
    ids.splice(toIndex, 0, taskId);
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('orderedIds', ids.join(','));
    const res = await reorderProgramme(fd);
    if (!res.ok) flash(res.error ?? 'Could not reorder');
    router.refresh();
  }

  function startDrag(e: ReactPointerEvent, session: DragSession) {
    if (!canModerate) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    // For a bar-body drag, the dominant axis decides: horizontal = reschedule,
    // vertical = reorder the row. Locked once the gesture passes the threshold.
    let axis: 'x' | 'y' | undefined;
    let cur = { startIso: session.origStart, endIso: session.origEnd };

    const onMove = (ev: globalThis.PointerEvent) => {
      if (session.mode === 'link') {
        const rows = rowsRef.current;
        if (!rows) return;
        const rect = rows.getBoundingClientRect();
        moved = true;
        const over = taskAtClientY(ev.clientY);
        setLink({
          fromId: session.taskId,
          fromEdge: session.fromEdge!,
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          overId: over && over.id !== session.taskId ? over.id : null,
        });
        return;
      }

      if (session.mode === 'move' && axis === undefined) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      }

      if (session.mode === 'move' && axis === 'y') {
        moved = true;
        const idx = indexAtClientY(ev.clientY);
        if (idx != null) setReorder({ taskId: session.taskId, overIndex: idx });
        return;
      }

      const days = Math.round((ev.clientX - startX) / DAY_W);
      if (days !== 0) moved = true;
      const t = todayIso();
      if (session.mode === 'move') {
        let s = shiftIso(session.origStart, days);
        let en = shiftIso(session.origEnd, days);
        if (s < t) {
          const back = diffDaysIso(t, s);
          s = shiftIso(s, back);
          en = shiftIso(en, back);
        }
        cur = { startIso: s, endIso: en };
      } else if (session.mode === 'resize-start') {
        let s = shiftIso(session.origStart, days);
        if (s < t) s = t;
        if (s > session.origEnd) s = session.origEnd;
        cur = { startIso: s, endIso: session.origEnd };
      } else {
        let en = shiftIso(session.origEnd, days);
        if (en < session.origStart) en = session.origStart;
        cur = { startIso: session.origStart, endIso: en };
      }
      setPreview({ taskId: session.taskId, startIso: cur.startIso, endIso: cur.endIso });
    };

    const onUp = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (session.mode === 'link') {
        const target = taskAtClientY(ev.clientY);
        setLink(null);
        if (target && target.id !== session.taskId) {
          const predecessorId = session.fromEdge === 'finish' ? session.taskId : target.id;
          const successorId = session.fromEdge === 'finish' ? target.id : session.taskId;
          void runLink(predecessorId, successorId);
        }
        return;
      }
      if (session.mode === 'move' && axis === 'y') {
        const target = indexAtClientY(ev.clientY);
        setReorder(null);
        if (target != null) void runReorder(session.taskId, target);
        return;
      }
      setPreview(null);
      if (!moved) {
        setSelected((prev) => (prev === session.taskId ? null : session.taskId));
        return;
      }
      if (cur.startIso !== session.origStart || cur.endIso !== session.origEnd) {
        void runReschedule(session.taskId, cur.startIso, cur.endIso);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  if (data.tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
        <GanttChart size={20} className="mx-auto text-zinc-300 dark:text-zinc-600" />
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          No scheduled tasks yet. Give tasks a planned start and end date and they&apos;ll appear on the programme.
        </p>
        {data.unscheduled.length > 0 && (
          <p className="mt-1 text-xs text-zinc-400">{data.unscheduled.length} task(s) have no dates yet.</p>
        )}
      </div>
    );
  }

  const rowsH = data.tasks.length * ROW_H;
  // "B starts after A" reading of the link being drawn (FS is the default).
  const linkLabel = (() => {
    if (!link) return null;
    const src = titleById.get(link.fromId) ?? 'Task';
    const tgt = link.overId ? (titleById.get(link.overId) ?? 'a task') : '…';
    return link.fromEdge === 'finish' ? `${tgt} starts after ${src}` : `${src} starts after ${tgt}`;
  })();
  const linkSourcePoint = (() => {
    if (!link || !geom) return null;
    const i = rowIndexById.get(link.fromId);
    const t = data.tasks.find((x) => x.id === link.fromId);
    if (i == null || !t) return null;
    const w = winOf(t);
    const x = link.fromEdge === 'finish' ? (geom.offset(w.endIso) + 1) * DAY_W : geom.offset(w.startIso) * DAY_W;
    return { x, y: i * ROW_H + ROW_H / 2 };
  })();

  return (
    <div className="space-y-4">
      {/* Finish summary + auto-schedule toggle */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {data.projectStart && (
          <span className="text-zinc-500 dark:text-zinc-400">
            Start <strong className="text-zinc-800 dark:text-zinc-100">{fmt(data.projectStart)}</strong>
          </span>
        )}
        {data.projectedFinish && (
          <span className="text-zinc-500 dark:text-zinc-400">
            Projected finish <strong className="text-zinc-800 dark:text-zinc-100">{fmt(data.projectedFinish)}</strong>
          </span>
        )}
        {data.baselineFinish && (
          <span className="text-zinc-500 dark:text-zinc-400">
            Baseline <strong className="text-zinc-800 dark:text-zinc-100">{fmt(data.baselineFinish)}</strong>
            {data.projectedFinish && data.projectedFinish !== data.baselineFinish && (
              <span className={data.projectedFinish > data.baselineFinish ? ' text-red-600 dark:text-red-400' : ' text-emerald-600 dark:text-emerald-400'}>
                {' '}
                ({data.projectedFinish > data.baselineFinish ? 'behind' : 'ahead'})
              </span>
            )}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {data.baselinedAt && (
            <button
              type="button"
              role="switch"
              aria-checked={showBaseline}
              onClick={() => setShowBaseline((v) => !v)}
              className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"
              title={`Baseline captured ${fmt(data.baselinedAt.slice(0, 10))}. Toggle the planned-vs-current comparison.`}
            >
              <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${showBaseline ? 'bg-zinc-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${showBaseline ? 'left-3.5' : 'left-0.5'}`} />
              </span>
              Baseline
            </button>
          )}
          {canModerate && (
            <button
              type="button"
              onClick={runBaseline}
              className="inline-flex items-center rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800/40"
              title="Snapshot the current plan as the baseline to track slippage against."
            >
              {data.baselinedAt ? 'Update baseline' : 'Set baseline'}
            </button>
          )}
          {canModerate && (
            <button
              type="button"
              role="switch"
              aria-checked={data.autoSchedule}
              onClick={toggleAuto}
              className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"
              title="When on, moving a task shifts its dependent tasks forward so a successor never starts before its predecessor finishes."
            >
              <span
                className={`relative h-4 w-7 shrink-0 rounded-full transition ${
                  data.autoSchedule ? 'bg-brand-500' : 'bg-zinc-300 dark:bg-zinc-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                    data.autoSchedule ? 'left-3.5' : 'left-0.5'
                  }`}
                />
              </span>
              Auto-schedule dependents
            </button>
          )}
        </div>
      </div>

      {data.hasCycle && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>A circular dependency was detected — the critical path can&apos;t be computed until it&apos;s resolved.</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {selectedTask && canModerate && (
        <RescheduleForm
          task={selectedTask}
          projectId={projectId}
          onDone={() => {
            setSelected(null);
            router.refresh();
          }}
          onCancel={() => setSelected(null)}
        />
      )}

      {/* The chart: fixed label column + horizontally-scrolling timeline. */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex">
          {/* Labels — task name + assignee */}
          <div className="shrink-0 border-r border-zinc-200 dark:border-zinc-800" style={{ width: LABEL_W }}>
            <div style={{ height: AXIS_H }} className="border-b border-zinc-200 bg-zinc-50 px-3 text-[11px] font-medium uppercase tracking-wide leading-[34px] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40">
              Task
            </div>
            {data.tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => canModerate && setSelected(t.id === selected ? null : t.id)}
                style={{ height: ROW_H }}
                className={`flex w-full items-center gap-1.5 overflow-hidden border-b border-zinc-100 px-3 text-left dark:border-zinc-800/70 ${
                  canModerate ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40' : 'cursor-default'
                } ${t.id === selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}
                title={t.assigneeName ? `${t.title} · ${t.assigneeName}` : t.title}
              >
                {t.critical && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-label="Critical" />}
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-xs text-zinc-700 dark:text-zinc-200">{t.title}</span>
                  <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                    {t.assigneeName ?? 'Unassigned'}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Timeline */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            {geom && (
              <div className="relative" style={{ width: geom.width }}>
                {/* Axis */}
                <div style={{ height: AXIS_H }} className="relative border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                  {geom.ticks.map((tick, i) => (
                    <div key={i} className="absolute top-0 h-full border-l border-zinc-200 pl-1 text-[10px] leading-[34px] text-zinc-400 dark:border-zinc-800" style={{ left: tick.x }}>
                      {tick.label}
                    </div>
                  ))}
                </div>

                {/* Rows + bars */}
                <div ref={rowsRef} className="relative" style={{ height: rowsH }}>
                  {/* Week gridlines */}
                  {geom.ticks.map((tick, i) => (
                    <div key={i} className="absolute top-0 h-full border-l border-zinc-100 dark:border-zinc-800/60" style={{ left: tick.x }} />
                  ))}
                  {/* Today marker */}
                  {geom.todayX != null && (
                    <div className="absolute top-0 z-10 h-full border-l-2 border-brand-500/70" style={{ left: geom.todayX }}>
                      <span className="absolute -top-0 left-1 text-[9px] font-medium text-brand-600 dark:text-brand-400">Today</span>
                    </div>
                  )}
                  {/* Link target row highlight */}
                  {link?.overId != null && rowIndexById.get(link.overId) != null && (
                    <div
                      className="pointer-events-none absolute left-0 z-0 bg-brand-500/10"
                      style={{ top: rowIndexById.get(link.overId)! * ROW_H, height: ROW_H, width: geom.width }}
                    />
                  )}
                  {/* Reorder drop indicator */}
                  {reorder && (
                    <div
                      className="pointer-events-none absolute left-0 z-30 h-0.5 bg-brand-500"
                      style={{ top: reorder.overIndex * ROW_H + ROW_H - 1, width: geom.width }}
                    />
                  )}

                  {/* Baseline ghosts — the frozen plan, drawn as a thin bar below each task */}
                  {showBaseline &&
                    data.tasks.map((t, i) => {
                      if (!t.baselineStartIso || !t.baselineEndIso) return null;
                      const bl = geom.offset(t.baselineStartIso) * DAY_W;
                      const bdays = diffDaysIso(t.baselineEndIso, t.baselineStartIso) + 1;
                      const bw = Math.max(bdays * DAY_W - 3, 6);
                      const slipped = t.endIso > t.baselineEndIso;
                      return (
                        <div
                          key={`bl-${t.id}`}
                          className={`absolute rounded-sm ${slipped ? 'bg-red-400/40 dark:bg-red-500/40' : 'bg-zinc-400/50 dark:bg-zinc-500/50'}`}
                          style={{ left: bl, top: i * ROW_H + ROW_H - 7, width: bw, height: 4 }}
                          title={`Baseline: ${fmt(t.baselineStartIso)}–${fmt(t.baselineEndIso)}`}
                        />
                      );
                    })}

                  {/* Dependency arrows (+ invisible hit paths to remove them) */}
                  <svg className="pointer-events-none absolute inset-0" width={geom.width} height={rowsH}>
                    <defs>
                      <marker id="pm-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" className="fill-zinc-400 dark:fill-zinc-500" />
                      </marker>
                      <marker id="pm-arrow-crit" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" className="fill-red-500" />
                      </marker>
                    </defs>
                    {data.edges.map((e, i) => {
                      const pi = rowIndexById.get(e.predecessorId);
                      const si = rowIndexById.get(e.successorId);
                      if (pi == null || si == null) return null;
                      const pt = data.tasks[pi]!;
                      const st = data.tasks[si]!;
                      const pw = winOf(pt);
                      const sw = winOf(st);
                      // Each end attaches to the finish or start of its bar, per type.
                      const predAtFinish = e.type === 'fs' || e.type === 'ff';
                      const succAtStart = e.type === 'fs' || e.type === 'ss';
                      const x1 = predAtFinish ? (geom.offset(pw.endIso) + 1) * DAY_W : geom.offset(pw.startIso) * DAY_W;
                      const y1 = pi * ROW_H + ROW_H / 2;
                      const x2 = succAtStart ? geom.offset(sw.startIso) * DAY_W : (geom.offset(sw.endIso) + 1) * DAY_W;
                      const y2 = si * ROW_H + ROW_H / 2;
                      const midX = Math.max(x1 + 8, x2 - 8);
                      const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
                      const crit = e.critical;
                      const showTag = e.type !== 'fs' || e.lagDays !== 0;
                      return (
                        <g key={i}>
                          <path
                            d={d}
                            fill="none"
                            className={crit ? 'stroke-red-500' : 'stroke-zinc-300 dark:stroke-zinc-600'}
                            strokeWidth={crit ? 2 : 1.5}
                            markerEnd={crit ? 'url(#pm-arrow-crit)' : 'url(#pm-arrow)'}
                          />
                          {showTag && (
                            <text x={midX + 3} y={(y1 + y2) / 2 - 3} fontSize={9} className="fill-zinc-500 dark:fill-zinc-400">
                              {depTag(e.type, e.lagDays)}
                            </text>
                          )}
                          {canModerate && (
                            <path
                              d={d}
                              fill="none"
                              stroke="transparent"
                              strokeWidth={11}
                              className="pointer-events-auto cursor-pointer"
                              onClick={() =>
                                setLinkMenu({ predecessorId: e.predecessorId, successorId: e.successorId, type: e.type, lag: e.lagDays, x: midX, y: (y1 + y2) / 2 })
                              }
                            >
                              <title>Edit dependency</title>
                            </path>
                          )}
                        </g>
                      );
                    })}
                    {/* In-progress link line */}
                    {link && linkSourcePoint && (
                      <line
                        x1={linkSourcePoint.x}
                        y1={linkSourcePoint.y}
                        x2={link.x}
                        y2={link.y}
                        className="stroke-brand-500"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                    )}
                  </svg>

                  {/* Bars */}
                  {data.tasks.map((t, i) => {
                    const w = winOf(t);
                    const left = geom.offset(w.startIso) * DAY_W;
                    const days = diffDaysIso(w.endIso, w.startIso) + 1;
                    const width = Math.max(days * DAY_W - 3, 8);
                    const dragging = preview?.taskId === t.id;
                    const reordering = reorder?.taskId === t.id;
                    const floatW = !t.critical && t.floatDays > 0 && !dragging ? t.floatDays * DAY_W : 0;
                    const variance = t.baselineEndIso ? diffDaysIso(w.endIso, t.baselineEndIso) : 0;
                    const varianceText = variance > 0 ? ` · ${variance}d behind baseline` : variance < 0 ? ` · ${-variance}d ahead of baseline` : '';
                    return (
                      <div key={t.id} className={`group absolute ${reordering ? 'opacity-40' : ''}`} style={{ top: i * ROW_H + 6, left, height: ROW_H - 12 }}>
                        {/* Total float (slack) + its value */}
                        {floatW > 0 && (
                          <>
                            <div
                              className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-zinc-300 dark:bg-zinc-600"
                              style={{ left: width, width: floatW }}
                              title={`${t.floatDays} day${t.floatDays === 1 ? '' : 's'} of total float — it can slip this long without delaying the finish`}
                            />
                            <span
                              className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[9px] tabular-nums text-zinc-400 dark:text-zinc-500"
                              style={{ left: width + floatW + 4 }}
                            >
                              {t.floatDays}d
                            </span>
                          </>
                        )}
                        <div
                          style={{ width }}
                          className={`relative flex h-full items-center overflow-hidden rounded text-[10px] font-medium text-white shadow-sm ${
                            STATUS_BAR[t.status]
                          } ${t.critical ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950' : ''} ${
                            t.scheduled ? '' : 'opacity-70'
                          } ${dragging ? 'ring-2 ring-brand-400' : ''}`}
                          title={`${t.title} · ${fmt(w.startIso)}–${fmt(w.endIso)} · ${STATUS_LABEL[t.status]}${
                            t.critical ? ' · critical' : t.floatDays > 0 ? ` · ${t.floatDays}d float` : ''
                          }${varianceText}${t.waitingOn.length ? ` · waiting on ${t.waitingOn.join(', ')}` : ''}`}
                        >
                          {canModerate && (
                            <span
                              onPointerDown={(e) => startDrag(e, { mode: 'resize-start', taskId: t.id, origStart: w.startIso, origEnd: w.endIso })}
                              className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
                              aria-hidden
                            />
                          )}
                          <span
                            onPointerDown={(e) => startDrag(e, { mode: 'move', taskId: t.id, origStart: w.startIso, origEnd: w.endIso })}
                            className={`flex h-full min-w-0 flex-1 items-center px-1.5 ${canModerate ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                          >
                            <span className="truncate">{t.title}</span>
                          </span>
                          {canModerate && (
                            <span
                              onPointerDown={(e) => startDrag(e, { mode: 'resize-end', taskId: t.id, origStart: w.startIso, origEnd: w.endIso })}
                              className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
                              aria-hidden
                            />
                          )}
                        </div>

                        {/* Connector handles — drag to another bar to link (finish→start) */}
                        {canModerate && (
                          <>
                            <span
                              onPointerDown={(e) => startDrag(e, { mode: 'link', taskId: t.id, origStart: w.startIso, origEnd: w.endIso, fromEdge: 'start' })}
                              className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-brand-500 bg-white opacity-0 group-hover:opacity-100 dark:bg-zinc-950"
                              style={{ left: -9 }}
                              title="Drag to a predecessor task"
                              aria-label="Link predecessor"
                            />
                            <span
                              onPointerDown={(e) => startDrag(e, { mode: 'link', taskId: t.id, origStart: w.startIso, origEnd: w.endIso, fromEdge: 'finish' })}
                              className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-brand-500 bg-white opacity-0 group-hover:opacity-100 dark:bg-zinc-950"
                              style={{ left: width + 3 }}
                              title="Drag to a dependent task"
                              aria-label="Link successor"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Live "starts after" hint while drawing a link */}
                  {link && linkLabel && (
                    <div
                      className="pointer-events-none absolute z-30 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow-md dark:bg-zinc-100 dark:text-zinc-900"
                      style={{ left: link.x + 10, top: link.y + 10 }}
                    >
                      {linkLabel}
                    </div>
                  )}

                  {/* Dependency editor popover */}
                  {linkMenu && (
                    <div
                      className="absolute z-20 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                      style={{ left: linkMenu.x, top: linkMenu.y + 6 }}
                    >
                      <LinkEditor
                        key={`${linkMenu.predecessorId}-${linkMenu.successorId}`}
                        projectId={projectId}
                        predecessorId={linkMenu.predecessorId}
                        successorId={linkMenu.successorId}
                        predTitle={titleById.get(linkMenu.predecessorId) ?? 'Task'}
                        succTitle={titleById.get(linkMenu.successorId) ?? 'Task'}
                        initialType={linkMenu.type}
                        initialLag={linkMenu.lag}
                        onDone={() => {
                          setLinkMenu(null);
                          router.refresh();
                        }}
                        onCancel={() => setLinkMenu(null)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm ring-2 ring-red-500" /> Critical path</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-red-500" /> Driving link</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> In progress</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Done</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-orange-500" /> Blocked</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-zinc-300 dark:bg-zinc-600" /> Total float (slack days)</span>
        {data.baselinedAt && <span className="inline-flex items-center gap-1.5"><span className="h-1 w-4 rounded-sm bg-zinc-400/60" /> Baseline (planned)</span>}
        {canModerate && <span>· Drag a bar sideways to move it, up/down to reorder, its edges to resize, the dots to link tasks, or a link to set its type</span>}
      </div>

      {data.unscheduled.length > 0 && (
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Not on the programme yet — no dates ({data.unscheduled.length})
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {data.unscheduled.map((t) => (
              <li key={t.id} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {t.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
