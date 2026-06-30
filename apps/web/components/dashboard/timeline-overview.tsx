'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { GanttChart, Calendar, Search } from '@/components/icons';
import {
  parseDate,
  startOfDay,
  addDays,
  differenceInDays,
  formatDayMonth,
  weekNumber,
} from '@/lib/date';
import type { DashboardTask } from '@/lib/data/dashboard';

/* ── Layout constants (mirror the previous app's Gantt) ─────────────── */
const SCALES = {
  day: { colWidth: 36, days: 1 },
  week: { colWidth: 120, days: 7 },
  month: { colWidth: 200, days: 30 },
} as const;
type Scale = keyof typeof SCALES;

const ROW_HEIGHT = 54;
const TASK_COL_WIDTH = 170;
const BAR_HEIGHT = 14;
const HEADER_H = 44;
const MAX_SPILL_DAYS = 4;

const STATUS_PILLS = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'active', label: 'Active' },
  { key: 'done', label: 'Done' },
] as const;
type StatusFilter = (typeof STATUS_PILLS)[number]['key'];

/* ── Derived per-task state ─────────────────────────────────────────── */
interface BarState {
  isDone: boolean;
  isBlocked: boolean;
  isActive: boolean;
  isPending: boolean;
  isTodo: boolean;
  isOverdue: boolean;
  isAtRisk: boolean;
  daysUntilDue: number | null;
  hasStarted: boolean;
}

interface TimelineTask extends DashboardTask {
  start: Date;
  end: Date;
}

function getBarState(task: DashboardTask): BarState {
  const today = startOfDay(new Date());
  const start = parseDate(task.planned_start_date);
  const due = parseDate(task.due_date) ?? parseDate(task.planned_end_date);
  if (start) start.setHours(0, 0, 0, 0);

  const isDone = task.status === 'done';
  const isBlocked = task.status === 'blocked' || task.sla_status === 'blocked';
  const isPending = task.status === 'submitted' || task.sla_status === 'pending_signoff';
  const autoStarted =
    task.status === 'todo' && !isBlocked && !isPending && !!start && start <= today;
  const isActive = task.status === 'in_progress' || autoStarted;
  const isTodo = task.status === 'todo' && !autoStarted;
  const isOverdue = !isDone && !!due && due < today;
  const daysUntilDue = due ? differenceInDays(due, today) : null;
  const isAtRisk =
    task.sla_status === 'at_risk' ||
    (isActive && daysUntilDue !== null && daysUntilDue > 0 && daysUntilDue <= 2 && !isOverdue);
  const hasStarted = isActive || isDone;

  return { isDone, isBlocked, isActive, isPending, isTodo, isOverdue, isAtRisk, daysUntilDue, hasStarted };
}

function barColor(s: BarState): string {
  if (s.isDone) return '#16a34a';
  if (s.isBlocked) return '#d97706';
  if (s.isOverdue) return '#93c5fd';
  if (s.isPending) return '#3b82f6';
  if (s.isActive) return '#2563eb';
  return 'transparent';
}

function shortLabel(s: BarState): string | null {
  if (s.isDone) return '✓ done';
  if (s.isOverdue && s.daysUntilDue !== null) return `${Math.abs(s.daysUntilDue)}d over`;
  if (s.isBlocked) return 'blocked';
  if (s.isPending) return 'in review';
  if (s.daysUntilDue !== null && s.daysUntilDue >= 0)
    return s.daysUntilDue === 0 ? 'due today' : `${s.daysUntilDue}d left`;
  return null;
}

function StatusBadge({ state }: { state: BarState }) {
  const map: { show: boolean; text: string; cls: string }[] = [
    { show: state.isDone, text: 'Done', cls: 'bg-green-100 text-green-700' },
    { show: state.isBlocked, text: 'Blocked', cls: 'bg-amber-100 text-amber-700' },
    { show: state.isOverdue, text: 'Overdue', cls: 'bg-red-100 text-red-700' },
    { show: state.isPending, text: 'Review', cls: 'bg-blue-100 text-blue-700' },
    { show: state.isActive, text: 'Active', cls: 'bg-blue-100 text-blue-700' },
  ];
  const hit = map.find((m) => m.show);
  if (!hit) return <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">To do</span>;
  return <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${hit.cls}`}>{hit.text}</span>;
}

/* ── Component ──────────────────────────────────────────────────────── */
export function TimelineOverview({ tasks: input }: { tasks: DashboardTask[] }) {
  const [scale, setScale] = useState<Scale>('day');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const DAY_WIDTH = SCALES[scale].colWidth / SCALES[scale].days;

  // Schedule every task that has at least one date; pad single-sided ranges.
  const { tasks, startDate, totalDays, days } = useMemo(() => {
    const today = startOfDay(new Date());
    const scheduled: TimelineTask[] = [];

    for (const t of input) {
      const start = parseDate(t.planned_start_date);
      const end = parseDate(t.planned_end_date) ?? parseDate(t.due_date);
      if (!start && !end) continue;
      scheduled.push({
        ...t,
        start: start ? startOfDay(start) : startOfDay(addDays(end!, -2)),
        end: end ? startOfDay(end) : startOfDay(addDays(start!, 2)),
      });
    }
    scheduled.sort((a, b) => a.start.getTime() - b.start.getTime());

    let minDate = today;
    let maxDate = addDays(today, 14);
    for (const t of scheduled) {
      if (t.start < minDate) minDate = t.start;
      if (t.end > maxDate) maxDate = t.end;
    }
    const start = startOfDay(addDays(minDate, -7));
    const end = startOfDay(addDays(maxDate, 14));
    const numDays = differenceInDays(end, start) + 1;
    const daysArr = Array.from({ length: numDays }, (_, i) => startOfDay(addDays(start, i)));
    return { tasks: scheduled, startDate: start, totalDays: numDays, days: daysArr };
  }, [input]);

  const scaleColumns = useMemo(() => {
    if (scale === 'day') return [];
    const step = SCALES[scale].days;
    const cols: { key: string; label: string; width: number }[] = [];
    for (let i = 0; i < totalDays; i += step) {
      const d = addDays(startDate, i);
      const span = Math.min(step, totalDays - i);
      cols.push({
        key: d.toISOString(),
        label:
          scale === 'week'
            ? `W${weekNumber(d)}`
            : d.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
        width: span * DAY_WIDTH,
      });
    }
    return cols;
  }, [scale, totalDays, startDate, DAY_WIDTH]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.projectName.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== 'all') {
        const s = getBarState(t);
        if (statusFilter === 'overdue' && !s.isOverdue) return false;
        if (statusFilter === 'blocked' && !s.isBlocked) return false;
        if (statusFilter === 'active' && !s.isActive) return false;
        if (statusFilter === 'done' && !s.isDone) return false;
      }
      return true;
    });
  }, [tasks, search, statusFilter]);

  const today = startOfDay(new Date());
  const todayOffset = differenceInDays(today, startDate) * DAY_WIDTH;
  const totalWidth = totalDays * DAY_WIDTH;
  const bodyHeight = filtered.length * ROW_HEIGHT;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, todayOffset - 200);
  }, [todayOffset]);

  const summary = useMemo(() => {
    const overdue = filtered.filter((t) => getBarState(t).isOverdue).length;
    const blocked = filtered.filter((t) => getBarState(t).isBlocked).length;
    return { showing: filtered.length, total: tasks.length, overdue, blocked };
  }, [filtered, tasks]);

  const pillBtn = (selected: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] transition-colors ${
      selected
        ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
        : 'border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
    }`;

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <GanttChart size={16} className="text-zinc-900 dark:text-white" />
          <h3 className="text-sm font-medium text-zinc-900 dark:text-white">Timeline Overview</h3>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Calendar size={28} className="text-zinc-300 dark:text-zinc-600" />
          <p className="text-sm text-zinc-500">No scheduled tasks yet.</p>
          <p className="text-xs text-zinc-400">Add planned dates to tasks to see them on the timeline.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <GanttChart size={16} className="text-zinc-900 dark:text-white" />
        <h3 className="text-sm font-medium text-zinc-900 dark:text-white">Timeline Overview</h3>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-44 rounded-md border border-zinc-200 bg-zinc-50 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {STATUS_PILLS.map((p) => (
            <button key={p.key} onClick={() => setStatusFilter(p.key)} className={pillBtn(statusFilter === p.key)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 text-[11px] text-zinc-500">
          <span>Scale:</span>
          {(Object.keys(SCALES) as Scale[]).map((s) => (
            <button key={s} onClick={() => setScale(s)} className={`capitalize ${pillBtn(scale === s)}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pb-2 text-[11px] text-zinc-400">
        Showing {summary.showing} of {summary.total} tasks
        {summary.overdue > 0 && <> · {summary.overdue} overdue</>}
        {summary.blocked > 0 && <> · {summary.blocked} blocked</>}
      </div>

      {filtered.length === 0 ? (
        <div className="py-8 text-center text-xs text-zinc-400">
          No tasks match the current filters.
          <button
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
            }}
            className="ml-2 font-medium text-brand-500"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div ref={scrollRef} className="relative max-h-[480px] overflow-auto">
          <div style={{ minWidth: TASK_COL_WIDTH + totalWidth, minHeight: HEADER_H + bodyHeight }}>
            {/* Header row */}
            <div className="sticky top-0 z-20 flex" style={{ height: HEADER_H }}>
              <div
                className="sticky left-0 z-30 flex items-end border-b border-r border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-800/40"
                style={{ width: TASK_COL_WIDTH, minWidth: TASK_COL_WIDTH }}
              >
                <span className="pb-1 text-[10px] tracking-wider text-zinc-400">TASK / ASSIGNEE</span>
              </div>
              <div
                className="flex border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40"
                style={{ minWidth: totalWidth }}
              >
                {scale === 'day'
                  ? days.map((day) => {
                      const isToday = differenceInDays(day, today) === 0;
                      return (
                        <div
                          key={day.toISOString()}
                          className={`flex items-center justify-center text-[10px] ${
                            isToday ? 'font-medium text-zinc-600 dark:text-zinc-300' : 'text-zinc-400'
                          }`}
                          style={{ flex: `0 0 ${DAY_WIDTH}px` }}
                        >
                          {formatDayMonth(day)}
                        </div>
                      );
                    })
                  : scaleColumns.map((col) => (
                      <div
                        key={col.key}
                        className="flex items-center justify-center text-[10px] text-zinc-400"
                        style={{ flex: `0 0 ${col.width}px` }}
                      >
                        {col.label}
                      </div>
                    ))}
              </div>
            </div>

            {/* Body */}
            <div className="relative">
              {todayOffset >= 0 && todayOffset <= totalWidth && (
                <div
                  className="pointer-events-none absolute z-10"
                  style={{
                    left: TASK_COL_WIDTH + todayOffset + DAY_WIDTH / 2,
                    top: 0,
                    width: 1.5,
                    height: bodyHeight,
                    background: '#2563eb',
                    opacity: 0.3,
                  }}
                />
              )}

              {filtered.map((task) => {
                const state = getBarState(task);
                const color = barColor(state);
                const left = differenceInDays(task.start, startDate) * DAY_WIDTH;
                const duration = differenceInDays(task.end, task.start) + 1;
                const ghostWidth = Math.max(duration * DAY_WIDTH - 2, DAY_WIDTH - 2);
                const todayX = todayOffset + DAY_WIDTH / 2;
                const plannedEndX = Math.max(0, left) + ghostWidth;

                const actualEndX = state.isDone ? plannedEndX : todayX;
                const actualWidth = state.hasStarted ? Math.max(actualEndX - Math.max(0, left), 0) : 0;
                const spill = state.isOverdue
                  ? Math.min(Math.max(todayX - plannedEndX, 0), MAX_SPILL_DAYS * DAY_WIDTH)
                  : 0;
                const label = shortLabel(state);
                const labelX = state.isOverdue ? plannedEndX + spill + 6 : Math.max(plannedEndX, left + actualWidth) + 6;

                const rowTint = state.isOverdue
                  ? 'bg-red-50/60 dark:bg-red-950/10'
                  : state.isBlocked
                    ? 'bg-amber-50/60 dark:bg-amber-950/10'
                    : 'bg-zinc-50/50 dark:bg-zinc-800/20';

                return (
                  <div
                    key={task.id}
                    className={`flex ${rowTint}`}
                    style={{ height: ROW_HEIGHT, marginBottom: 2, borderRadius: 7 }}
                  >
                    {/* Frozen task label */}
                    <div
                      className="sticky left-0 z-[15] flex flex-col justify-center overflow-hidden border-r border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-800/40"
                      style={{ width: TASK_COL_WIDTH, minWidth: TASK_COL_WIDTH }}
                    >
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <span className="flex-1 truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                          {task.title}
                        </span>
                        <StatusBadge state={state} />
                      </div>
                      <span className="mt-0.5 truncate text-[10px] text-zinc-400">
                        {task.assigneeName ?? 'Unassigned'}
                      </span>
                      <span className="truncate text-[10px] text-zinc-400/70">{task.projectName}</span>
                    </div>

                    {/* Bar lane */}
                    <div className="relative flex items-center" style={{ flex: 1, minWidth: totalWidth }}>
                      {todayOffset >= 0 && todayOffset <= totalWidth && (
                        <div
                          className="pointer-events-none absolute inset-y-0 z-[4]"
                          style={{ left: todayX, width: 1.5, background: '#2563eb', opacity: 0.3 }}
                        />
                      )}

                      {/* Ghost (scheduled) track */}
                      <div
                        className="absolute rounded-[3px]"
                        style={{
                          left: Math.max(0, left),
                          width: ghostWidth,
                          height: BAR_HEIGHT,
                          background: '#d4d4d8',
                          opacity: state.isTodo ? 0.5 : state.isDone ? 0.4 : 0.8,
                        }}
                      />

                      {/* Progress / done bar */}
                      {(state.hasStarted || state.isOverdue) && (state.isOverdue ? ghostWidth : actualWidth) > 0 && (
                        <div
                          className="absolute overflow-hidden rounded-[3px]"
                          style={{
                            left: state.isOverdue ? Math.max(0, left) : Math.max(0, left),
                            width: state.isOverdue ? ghostWidth : actualWidth,
                            height: BAR_HEIGHT,
                            background: state.isOverdue ? '#93c5fd' : color,
                          }}
                        />
                      )}

                      {/* Overdue red spill */}
                      {state.isOverdue && spill > 0 && (
                        <div
                          className="absolute"
                          style={{
                            left: plannedEndX,
                            width: spill,
                            height: BAR_HEIGHT,
                            background: '#dc2626',
                            borderRadius: '0 3px 3px 0',
                          }}
                        />
                      )}

                      {label && (
                        <span
                          className="pointer-events-none absolute whitespace-nowrap text-[10px] font-medium"
                          style={{
                            left: labelX,
                            top: ROW_HEIGHT / 2 - 7,
                            color: state.isOverdue
                              ? '#dc2626'
                              : state.isDone
                                ? '#16a34a'
                                : state.isBlocked
                                  ? '#d97706'
                                  : '#a1a1aa',
                          }}
                        >
                          {label}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        {[
          { c: '#d4d4d8', l: 'Scheduled' },
          { c: '#2563eb', l: 'Active' },
          { c: '#16a34a', l: 'Done' },
          { c: '#dc2626', l: 'Overdue' },
          { c: '#d97706', l: 'Blocked' },
          { c: '#3b82f6', l: 'In review' },
        ].map((item) => (
          <span key={item.l} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="inline-block h-2 w-5 rounded-sm" style={{ background: item.c }} />
            {item.l}
          </span>
        ))}
      </div>
    </div>
  );
}
