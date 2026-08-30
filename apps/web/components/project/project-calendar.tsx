'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, Users, GanttChart } from '@/components/icons';
import { parseDate, startOfDay, formatDayMonth } from '@/lib/date';
import type { CalendarTask } from '@/lib/data/project-calendar';
import type { CalendarActionItem } from '@/lib/data/action-items';
import { EVENT_KIND_LABEL, type CalendarEvent } from '@/lib/data/events';
import type { TaskPriority } from '@datumpro/shared/domain';

/* Priority accents — the app-wide colour language (see ui/tones.ts): urgent red,
 *  high orange, medium/low quiet. Left borders echo the badge hue. */
const PRIORITY_STYLE: Record<TaskPriority, { badge: string; border: string; label: string }> = {
  urgent: {
    badge: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
    border: 'border-red-400 dark:border-red-500',
    label: 'Urgent',
  },
  high: {
    badge: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',
    border: 'border-orange-300 dark:border-orange-500',
    label: 'High',
  },
  medium: {
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    border: 'border-zinc-300 dark:border-zinc-600',
    label: 'Medium',
  },
  low: {
    badge: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    border: 'border-zinc-200 dark:border-zinc-700',
    label: 'Low',
  },
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** The task's schedule window (start/end at local midnight), or its due day. */
function taskWindow(task: CalendarTask): { start: Date; end: Date } | null {
  const start = parseDate(task.planned_start_date);
  const end = parseDate(task.planned_end_date) ?? parseDate(task.due_date);
  if (start && end) return { start: startOfDay(start), end: startOfDay(end) };
  const due = parseDate(task.due_date) ?? end;
  if (due) {
    const d = startOfDay(due);
    return { start: d, end: d };
  }
  return null;
}

function dueDay(task: CalendarTask): Date | null {
  const due = parseDate(task.due_date) ?? parseDate(task.planned_end_date);
  return due ? startOfDay(due) : null;
}

function formatRange(start: Date, end: Date): string {
  return isSameDay(start, end) ? formatDayMonth(end) : `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

function eventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function ProjectCalendar({
  tasks,
  actionItems = [],
  events = [],
  projectId,
}: {
  tasks: CalendarTask[];
  actionItems?: CalendarActionItem[];
  events?: CalendarEvent[];
  projectId: string;
}) {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));

  // Events keyed by their local start day (a timestamp, so bucket in local time).
  const eventsWithDay = useMemo(
    () => events.map((e) => ({ ev: e, day: startOfDay(new Date(e.startsAt)) })),
    [events],
  );
  const eventsForDate = (date: Date) => eventsWithDay.filter(({ day }) => isSameDay(day, date)).map(({ ev }) => ev);
  const upcomingEvents = useMemo(
    () =>
      eventsWithDay
        .filter(({ ev }) => ev.status === 'scheduled' && new Date(ev.startsAt).getTime() >= Date.now())
        .sort((a, b) => new Date(a.ev.startsAt).getTime() - new Date(b.ev.startsAt).getTime())
        .slice(0, 5),
    [eventsWithDay],
  );

  // To-dos (action items) keyed by their due day.
  const todosWithDay = useMemo(
    () =>
      actionItems
        .map((a) => ({ item: a, due: parseDate(a.dueDate) }))
        .filter((x): x is { item: CalendarActionItem; due: Date } => x.due !== null)
        .map((x) => ({ item: x.item, due: startOfDay(x.due) })),
    [actionItems],
  );
  const todosForDate = (date: Date) => todosWithDay.filter(({ due }) => isSameDay(due, date)).map(({ item }) => item);
  const openTodosForDate = (date: Date) =>
    todosWithDay.filter(({ item, due }) => item.status === 'open' && isSameDay(due, date)).length;
  const upcomingTodos = useMemo(
    () =>
      todosWithDay
        .filter(({ item, due }) => item.status === 'open' && due >= today)
        .sort((a, b) => a.due.getTime() - b.due.getTime())
        .slice(0, 5),
    [todosWithDay, today],
  );
  const overdueTodos = useMemo(
    () =>
      todosWithDay
        .filter(({ item, due }) => item.status === 'open' && due < today)
        .sort((a, b) => a.due.getTime() - b.due.getTime()),
    [todosWithDay, today],
  );

  const windows = useMemo(
    () => tasks.map((t) => ({ task: t, win: taskWindow(t) })).filter((x) => x.win !== null) as {
      task: CalendarTask;
      win: { start: Date; end: Date };
    }[],
    [tasks],
  );

  const tasksForDate = (date: Date) =>
    windows.filter(({ win }) => date >= win.start && date <= win.end).map(({ task }) => task);

  const upcoming = useMemo(
    () =>
      tasks
        .map((t) => ({ task: t, due: dueDay(t) }))
        .filter((x): x is { task: CalendarTask; due: Date } => !!x.due && x.due >= today && x.task.status !== 'done')
        .sort((a, b) => a.due.getTime() - b.due.getTime())
        .slice(0, 5),
    [tasks, today],
  );

  const overdue = useMemo(
    () =>
      tasks
        .map((t) => ({ task: t, due: dueDay(t) }))
        .filter((x): x is { task: CalendarTask; due: Date } => !!x.due && x.due < today && x.task.status !== 'done')
        .sort((a, b) => a.due.getTime() - b.due.getTime()),
    [tasks, today],
  );

  // Month grid: leading blanks so day 1 lands under its weekday column.
  const monthDays = useMemo(() => {
    const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const count = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
    for (let i = 1; i <= count; i++) {
      cells.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i));
    }
    return cells;
  }, [currentMonth]);

  const changeMonth = (dir: -1 | 1) =>
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));

  const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const selectedTasks = tasksForDate(selectedDate);
  const selectedTodos = todosForDate(selectedDate);
  const selectedEvents = eventsForDate(selectedDate);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Calendar */}
      <div className="lg:col-span-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-white max-sm:hidden">
              <CalendarIcon size={18} /> Task Calendar
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={() => changeMonth(-1)} aria-label="Previous month">
                <ChevronLeft size={20} className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white" />
              </button>
              <span className="text-sm text-zinc-900 dark:text-white">{monthLabel}</span>
              <button onClick={() => changeMonth(1)} aria-label="Next month">
                <ChevronRight size={20} className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white" />
              </button>
            </div>
          </div>

          <div className="mb-2 grid grid-cols-7 text-center text-xs text-zinc-600 dark:text-zinc-400">
            {WEEKDAYS.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {monthDays.map((day, i) => {
              if (!day) return <div key={`pad-${i}`} />;
              const dayTasks = tasksForDate(day);
              const dayTodos = openTodosForDate(day);
              const dayEvents = eventsForDate(day).filter((e) => e.status === 'scheduled').length;
              const isSelected = isSameDay(day, selectedDate);
              const hasOverdue =
                day < today &&
                (dayTasks.some((t) => t.status !== 'done') || todosForDate(day).some((a) => a.status === 'open'));
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDate(day)}
                  className={`flex flex-col items-center justify-center rounded-md py-1 text-sm sm:h-14 ${
                    isSelected
                      ? 'bg-brand-500/20 text-brand-700 dark:bg-brand-600 dark:text-white'
                      : 'bg-zinc-50 text-zinc-900 hover:bg-zinc-100 dark:bg-zinc-800/40 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  } ${hasOverdue ? 'border border-red-300 dark:border-red-500' : ''} ${
                    isSameDay(day, today) && !isSelected ? 'font-semibold' : ''
                  }`}
                >
                  <span>{day.getDate()}</span>
                  {dayTasks.length > 0 && (
                    <span className="text-[10px] text-brand-600 dark:text-brand-500">
                      {dayTasks.length} task{dayTasks.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {dayTodos > 0 && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                      {dayTodos} to-do{dayTodos === 1 ? '' : 's'}
                    </span>
                  )}
                  {dayEvents > 0 && (
                    <span className="text-[10px] text-violet-600 dark:text-violet-400">
                      {dayEvents} event{dayEvents === 1 ? '' : 's'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tasks for the selected day */}
        {selectedTasks.length > 0 && (
          <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-white">
                Tasks for {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </h3>
              <Link
                href={`/projects/${projectId}`}
                className="flex items-center gap-1 text-sm text-brand-500 transition hover:text-brand-600"
              >
                <GanttChart size={16} /> View timeline
              </Link>
            </div>
            <div className="space-y-3">
              {selectedTasks.map((task) => {
                const win = taskWindow(task)!;
                const ps = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium;
                return (
                  <Link
                    key={task.id}
                    href={`/projects/${projectId}/tasks/${task.id}`}
                    className={`block rounded border-l-4 bg-zinc-50 p-4 transition hover:bg-zinc-100 dark:bg-zinc-800/40 dark:hover:bg-zinc-800 ${ps.border}`}
                  >
                    <div className="mb-2 flex justify-between gap-2">
                      <h4 className="font-medium text-zinc-900 dark:text-white">{task.title}</h4>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${ps.badge}`}>{ps.label}</span>
                    </div>
                    <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="flex items-center gap-1 text-brand-500">
                        <CalendarIcon size={12} />
                        {formatRange(win.start, win.end)}
                      </span>
                      {task.assigneeName && (
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {task.assigneeName}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Events on the selected day */}
        {selectedEvents.length > 0 && (
          <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-white">
                Events on {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </h3>
              <Link href={`/projects/${projectId}/chat`} className="text-sm text-brand-500 transition hover:text-brand-600">
                Open chat
              </Link>
            </div>
            <div className="space-y-2">
              {selectedEvents.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/projects/${projectId}/chat`}
                  className="block rounded border-l-4 border-violet-300 bg-zinc-50 p-3 transition hover:bg-zinc-100 dark:border-violet-500 dark:bg-zinc-800/40 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className={ev.status === 'cancelled' ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-900 dark:text-white'}>
                      {ev.title}
                    </span>
                    <span className="shrink-0 rounded bg-violet-50 px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                      {EVENT_KIND_LABEL[ev.kind]}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {eventTime(ev.startsAt)}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* To-dos due on the selected day */}
        {selectedTodos.length > 0 && (
          <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-white">
                To-dos due {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </h3>
              <Link href={`/projects/${projectId}/chat`} className="text-sm text-brand-500 transition hover:text-brand-600">
                Open chat
              </Link>
            </div>
            <div className="space-y-2">
              {selectedTodos.map((a) => (
                <Link
                  key={a.id}
                  href={`/projects/${projectId}/chat`}
                  className="block rounded border-l-4 border-amber-300 bg-zinc-50 p-3 transition hover:bg-zinc-100 dark:border-amber-500 dark:bg-zinc-800/40 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className={a.status === 'done' ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-900 dark:text-white'}>
                      {a.title}
                    </span>
                    {a.status === 'done' && <span className="shrink-0 text-xs text-green-600 dark:text-green-400">Done</span>}
                  </div>
                  {a.assigneeName && <p className="text-xs text-zinc-500 dark:text-zinc-400">For {a.assigneeName}</p>}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-white">
            <Clock size={16} /> Upcoming Tasks
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">No upcoming tasks</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map(({ task }) => {
                const win = taskWindow(task)!;
                const ps = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium;
                return (
                  <Link
                    key={task.id}
                    href={`/projects/${projectId}/tasks/${task.id}`}
                    className="block rounded-lg bg-zinc-50 p-3 transition hover:bg-zinc-100 dark:bg-zinc-800/40 dark:hover:bg-zinc-800"
                  >
                    <div className="flex items-start justify-between gap-2 text-sm">
                      <span className="text-zinc-900 dark:text-white">{task.title}</span>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${ps.badge}`}>{ps.label}</span>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{formatRange(win.start, win.end)}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {overdue.length > 0 && (
          <div className="rounded-lg border border-l-4 border-red-300 bg-white p-4 dark:border-red-500 dark:bg-zinc-950">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
              <Clock size={16} /> Overdue Tasks ({overdue.length})
            </h3>
            <div className="space-y-2">
              {overdue.slice(0, 5).map(({ task, due }) => (
                <Link
                  key={task.id}
                  href={`/projects/${projectId}/tasks/${task.id}`}
                  className="block rounded-lg bg-red-50 p-3 transition hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30"
                >
                  <div className="flex justify-between gap-2 text-sm text-zinc-900 dark:text-white">
                    <span>{task.title}</span>
                    <span className="shrink-0 rounded bg-red-200 px-2 py-0.5 text-xs text-red-900 dark:bg-red-500">
                      Overdue
                    </span>
                  </div>
                  <p className="text-xs text-red-600 dark:text-red-300">Due {formatDayMonth(due)}</p>
                </Link>
              ))}
              {overdue.length > 5 && (
                <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">+{overdue.length - 5} more</p>
              )}
            </div>
          </div>
        )}

        {(upcomingTodos.length > 0 || overdueTodos.length > 0) && (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-white">
              <Clock size={16} /> To-dos
            </h3>
            <div className="space-y-2">
              {overdueTodos.map(({ item, due }) => (
                <Link
                  key={item.id}
                  href={`/projects/${projectId}/chat`}
                  className="block rounded-lg bg-red-50 p-3 transition hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30"
                >
                  <div className="flex justify-between gap-2 text-sm text-zinc-900 dark:text-white">
                    <span>{item.title}</span>
                    <span className="shrink-0 rounded bg-red-200 px-2 py-0.5 text-xs text-red-900 dark:bg-red-500">Overdue</span>
                  </div>
                  <p className="text-xs text-red-600 dark:text-red-300">
                    Due {formatDayMonth(due)}
                    {item.assigneeName ? ` · ${item.assigneeName}` : ''}
                  </p>
                </Link>
              ))}
              {upcomingTodos.map(({ item, due }) => (
                <Link
                  key={item.id}
                  href={`/projects/${projectId}/chat`}
                  className="block rounded-lg bg-zinc-50 p-3 transition hover:bg-zinc-100 dark:bg-zinc-800/40 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <span className="text-zinc-900 dark:text-white">{item.title}</span>
                    <span className="shrink-0 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      To-do
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Due {formatDayMonth(due)}
                    {item.assigneeName ? ` · ${item.assigneeName}` : ''}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {upcomingEvents.length > 0 && (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-white">
              <CalendarIcon size={16} /> Upcoming events
            </h3>
            <div className="space-y-2">
              {upcomingEvents.map(({ ev }) => (
                <Link
                  key={ev.id}
                  href={`/projects/${projectId}/chat`}
                  className="block rounded-lg bg-zinc-50 p-3 transition hover:bg-zinc-100 dark:bg-zinc-800/40 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <span className="text-zinc-900 dark:text-white">{ev.title}</span>
                    <span className="shrink-0 rounded bg-violet-50 px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                      {EVENT_KIND_LABEL[ev.kind]}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {formatDayMonth(startOfDay(new Date(ev.startsAt)))} · {eventTime(ev.startsAt)}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
