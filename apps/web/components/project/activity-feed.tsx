'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ACTIVITY_TYPES, dotClass, groupByDay, relativeTime, typeLabel } from './activity-format';
import type { ProjectActivityRow } from '@/lib/data/tasks';

export interface ActivityFeedMember {
  userId: string;
  name: string;
}

/* The full activity log, shared by the drill-down modal and the /activity page:
 * grouped by day, filterable by type and person, each row links to its task. */
export function ActivityFeed({
  items,
  members,
  projectId,
}: {
  items: ProjectActivityRow[];
  members: ActivityFeedMember[];
  projectId: string;
}) {
  const [type, setType] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      items.filter(
        (i) => (!type || i.type === type) && (!person || i.userId === person),
      ),
    [items, type, person],
  );
  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!type} onClick={() => setType(null)}>
            All
          </Chip>
          {ACTIVITY_TYPES.map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>
              {typeLabel(t)}
            </Chip>
          ))}
        </div>
        {members.length > 0 && (
          <select
            value={person ?? ''}
            onChange={(e) => setPerson(e.target.value || null)}
            aria-label="Filter by person"
            className="ml-auto rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="">Everyone</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No activity matches these filters.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {group.label}
              </p>
              <ol className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-3 left-[5.5px] top-3 w-px bg-zinc-200 dark:bg-zinc-800"
                />
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/projects/${projectId}/tasks/${item.taskId}`}
                      className="group flex items-start gap-2.5 rounded-md py-2 pr-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    >
                      <span className="relative z-10 mt-1 flex w-3 shrink-0 justify-center">
                        <span
                          className={`h-[7px] w-[7px] rounded-full ring-2 ring-white dark:ring-zinc-950 ${dotClass(item.type)}`}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {item.taskTitle}
                          </span>
                          <span className="text-zinc-400 dark:text-zinc-600"> · </span>
                          <span className="text-zinc-600 dark:text-zinc-400">{item.message}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-500">
                          {item.userName}
                        </span>
                      </span>
                      <span className="shrink-0 pt-0.5 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                        {relativeTime(item.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-zinc-900'
          : 'rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900'
      }
    >
      {children}
    </button>
  );
}
