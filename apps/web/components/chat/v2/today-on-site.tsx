'use client';

import { useState } from 'react';
import { ChevronDown } from '@/components/icons';
import { ChatActionItems, type ActionMember } from '@/components/chat/chat-action-items';
import { ChatEvents } from '@/components/chat/chat-events';
import type { ActionItem } from '@/lib/data/action-items';
import type { ProjectEvent } from '@/lib/data/events-types';

/** One quiet strip that replaces the two bolted-on To-dos/Events cards. Shows
 *  counts, expands inline to the full management UIs, and disappears entirely
 *  when there is nothing on for the day. */
export function TodayOnSite({
  projectId,
  conversationId,
  actionItems,
  events,
  members,
  canManage,
  currentUserId,
}: {
  projectId: string;
  conversationId: string;
  actionItems: ActionItem[];
  events: ProjectEvent[];
  members: ActionMember[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const openTodos = actionItems.filter((i) => !i.doneAt).length;
  const upcoming = events.length;
  // Managers can always open the strip to add items; everyone else only sees it
  // when there is something on.
  if (openTodos === 0 && upcoming === 0 && !canManage) return null;

  const parts = [
    `${openTodos} to-do${openTodos === 1 ? '' : 's'}`,
    `${upcoming} event${upcoming === 1 ? '' : 's'}`,
  ];

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        <span className="font-medium text-zinc-900 dark:text-zinc-100">Today on site</span>
        <span className="tabular-nums">{parts.join(' · ')}</span>
        <ChevronDown size={14} className={`ml-auto transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-3 border-t border-zinc-100 p-3 dark:border-zinc-800 lg:grid-cols-2">
          <ChatActionItems
            projectId={projectId}
            conversationId={conversationId}
            items={actionItems}
            members={members}
            canManage={canManage}
            currentUserId={currentUserId}
          />
          <ChatEvents
            projectId={projectId}
            conversationId={conversationId}
            events={events}
            members={members}
            canManage={canManage}
            currentUserId={currentUserId}
          />
        </div>
      )}
    </div>
  );
}
