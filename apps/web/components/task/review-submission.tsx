'use client';

import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { approveTask, rejectTask } from '@/app/(app)/projects/[projectId]/tasks/actions';

const textareaClass =
  'w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-brand-500 dark:border-zinc-800';

/** Sign-off controls: Approve (marks the task done) and Reject (sends it back to
 *  the assignee with a reason). Reject opens a popup for the note — the task is
 *  NOT completed; it returns to in-progress and the reason is logged to Activity. */
export function ReviewSubmission({ taskId }: { taskId: string }) {
  const [rejectOpen, setRejectOpen] = useState(false);

  return (
    <>
      <Card>
        <CardTitle>Review submission</CardTitle>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
          Approve to mark the task done, or send it back to the assignee to fix and resubmit.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <form action={approveTask} className="flex-1">
            <input type="hidden" name="taskId" value={taskId} />
            <SubmitButton className="h-[44px] w-full text-[14.5px]" pendingText="Approving…">
              Approve
            </SubmitButton>
          </form>
          <button
            type="button"
            onClick={() => setRejectOpen(true)}
            className="inline-flex h-[44px] flex-1 items-center justify-center rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            Reject
          </button>
        </div>
      </Card>

      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-6">
          <div className="w-[420px] rounded-2xl bg-white p-[22px] shadow-2xl dark:bg-zinc-900">
            <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Send back to the assignee</h4>
            <p className="mt-1 text-[13px] leading-[1.55] text-zinc-500 dark:text-zinc-400">
              The task returns to them with your note to fix and resubmit — it won&apos;t be marked done. Your reason is
              recorded in the task&apos;s Activity.
            </p>
            <form action={rejectTask} className="mt-4 space-y-3">
              <input type="hidden" name="taskId" value={taskId} />
              <textarea
                name="reason"
                rows={3}
                required
                placeholder="What needs fixing before this can be approved?"
                className={textareaClass}
              />
              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setRejectOpen(false)}
                  className="h-[38px] rounded-lg border border-zinc-200 px-4 text-[13.5px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex h-[38px] items-center justify-center rounded-lg bg-red-600 px-[18px] text-[13.5px] font-semibold text-white hover:bg-red-700"
                >
                  Send back
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
