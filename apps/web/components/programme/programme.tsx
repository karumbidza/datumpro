'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { AlertTriangle, GanttChart } from '@/components/icons';
import { parseDate, startOfDay, addDays, differenceInDays, formatDayMonth } from '@/lib/date';
import type { TaskStatus } from '@datumpro/shared/domain';
import type { ProgrammeData, ProgrammeTask } from '@/lib/data/programme-types';
import { rescheduleTask } from '@/app/(app)/projects/[projectId]/programme/actions';

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

/** The project programme: a Gantt timeline with a critical-path highlight, float,
 *  dependency arrows, a today marker and projected-vs-baseline finish. Managers can
 *  click a bar to reschedule it inline. */
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
    // Week ticks (every 7 days from the padded start).
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

  const selectedTask = data.tasks.find((t) => t.id === selected) ?? null;

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

  return (
    <div className="space-y-4">
      {/* Finish summary */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
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
      </div>

      {data.hasCycle && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>A circular dependency was detected — the critical path can&apos;t be computed until it&apos;s resolved.</span>
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
          {/* Labels */}
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
                className={`flex w-full items-center gap-1.5 border-b border-zinc-100 px-3 text-left text-xs dark:border-zinc-800/70 ${
                  canModerate ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40' : 'cursor-default'
                } ${t.id === selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}
                title={t.title}
              >
                {t.critical && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-label="Critical" />}
                <span className="truncate text-zinc-700 dark:text-zinc-200">{t.title}</span>
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
                <div className="relative" style={{ height: rowsH }}>
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

                  {/* Dependency arrows */}
                  <svg className="pointer-events-none absolute inset-0" width={geom.width} height={rowsH}>
                    <defs>
                      <marker id="pm-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" className="fill-zinc-400 dark:fill-zinc-500" />
                      </marker>
                    </defs>
                    {data.edges.map((e, i) => {
                      const pi = rowIndexById.get(e.predecessorId);
                      const si = rowIndexById.get(e.successorId);
                      if (pi == null || si == null) return null;
                      const pt = data.tasks[pi]!;
                      const st = data.tasks[si]!;
                      const x1 = (geom.offset(pt.endIso) + 1) * DAY_W;
                      const y1 = pi * ROW_H + ROW_H / 2;
                      const x2 = geom.offset(st.startIso) * DAY_W;
                      const y2 = si * ROW_H + ROW_H / 2;
                      const midX = Math.max(x1 + 8, x2 - 8);
                      const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
                      const crit = pt.critical && st.critical;
                      return (
                        <path
                          key={i}
                          d={d}
                          fill="none"
                          className={crit ? 'stroke-red-400/80' : 'stroke-zinc-300 dark:stroke-zinc-600'}
                          strokeWidth={1.5}
                          markerEnd="url(#pm-arrow)"
                        />
                      );
                    })}
                  </svg>

                  {/* Bars */}
                  {data.tasks.map((t, i) => {
                    const left = geom.offset(t.startIso) * DAY_W;
                    const days = differenceInDays(startOfDay(parseDate(t.endIso)!), startOfDay(parseDate(t.startIso)!)) + 1;
                    const w = Math.max(days * DAY_W - 3, 8);
                    const floatW = !t.critical && t.floatDays > 0 ? t.floatDays * DAY_W : 0;
                    return (
                      <div key={t.id} className="absolute" style={{ top: i * ROW_H + 6, left, height: ROW_H - 12 }}>
                        {/* Float slack */}
                        {floatW > 0 && (
                          <div
                            className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-zinc-300 dark:bg-zinc-600"
                            style={{ left: w, width: floatW }}
                            title={`${t.floatDays} day${t.floatDays === 1 ? '' : 's'} float`}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => canModerate && setSelected(t.id === selected ? null : t.id)}
                          style={{ width: w }}
                          className={`group relative flex h-full items-center overflow-hidden rounded px-1.5 text-[10px] font-medium text-white shadow-sm ${
                            STATUS_BAR[t.status]
                          } ${t.critical ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950' : ''} ${
                            canModerate ? 'cursor-pointer' : 'cursor-default'
                          } ${t.scheduled ? '' : 'opacity-70'}`}
                          title={`${t.title} · ${fmt(t.startIso)}–${fmt(t.endIso)} · ${STATUS_LABEL[t.status]}${
                            t.critical ? ' · critical' : t.floatDays > 0 ? ` · ${t.floatDays}d float` : ''
                          }${t.waitingOn.length ? ` · waiting on ${t.waitingOn.join(', ')}` : ''}`}
                        >
                          <span className="truncate">{t.assigneeName ?? t.title}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm ring-2 ring-red-500" /> Critical path</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> In progress</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Done</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-orange-500" /> Blocked</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-zinc-300 dark:bg-zinc-600" /> Float</span>
        {canModerate && <span>· Click a task to reschedule it</span>}
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
