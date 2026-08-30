'use client';

import { toastAccent, type ToastAccent, type ToastModel } from '@datumpro/shared/domain';
import { X } from '@/components/icons';

const ACCENT_BAR: Record<ToastAccent, string> = {
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  blue: 'bg-brand-500',
  neutral: 'bg-zinc-400 dark:bg-zinc-600',
};

/** One toast card: org context line, title, body, dismiss. The body is a button
 *  (opens the link) when there's a link; the ✕ always dismisses. */
export function ToastCard({
  toast,
  onOpen,
  onDismiss,
}: {
  toast: ToastModel;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const clickable = Boolean(toast.link);
  return (
    <div className="relative flex w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <span className={`w-1 shrink-0 ${ACCENT_BAR[toastAccent(toast.type)]}`} aria-hidden />
      <button
        type="button"
        onClick={clickable ? onOpen : onDismiss}
        className={`min-w-0 flex-1 px-3.5 py-3 text-left ${
          clickable ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50' : 'cursor-default'
        }`}
      >
        {toast.orgName && (
          <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />
            {toast.orgName}
          </span>
        )}
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{toast.title}</p>
        {toast.body && (
          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{toast.body}</p>
        )}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 px-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        <X size={14} />
      </button>
    </div>
  );
}
