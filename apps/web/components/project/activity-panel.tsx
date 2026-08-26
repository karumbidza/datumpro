'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ChevronRight, X } from '@/components/icons';
import { ActivityPreview } from './activity-preview';
import { ActivityFeed, type ActivityFeedMember } from './activity-feed';
import type { ProjectActivityRow } from '@/lib/data/tasks';

const PREVIEW_COUNT = 5;

/* Recent Activity on the project overview: a slim preview of the latest events
 * with a drill-down into the full log — an overlay modal that is also the real
 * /activity page (for shared/refreshed links and mobile). */
export function ActivityPanel({
  items,
  members,
  projectId,
}: {
  items: ProjectActivityRow[];
  members: ActivityFeedMember[];
  projectId: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <section aria-label="Recent activity">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={15} className="text-zinc-400 dark:text-zinc-500" />
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Recent activity
          </h2>
        </div>
        {items.length > PREVIEW_COUNT && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-0.5 text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-500 dark:hover:text-brand-400"
          >
            View all activity
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      <ActivityPreview items={items.slice(0, PREVIEW_COUNT)} projectId={projectId} />

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Project activity"
            className="mt-6 w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-zinc-900 dark:text-white" />
                <h3 className="text-sm font-medium text-zinc-900 dark:text-white">Activity</h3>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/projects/${projectId}/activity`}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-500 dark:hover:text-brand-400"
                >
                  Open full page
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <ActivityFeed items={items} members={members} projectId={projectId} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
