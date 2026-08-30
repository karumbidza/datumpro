'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  enqueueToast,
  notificationRowToToast,
  MAX_VISIBLE_TOASTS,
  type ToastModel,
  type NotificationRow,
} from '@datumpro/shared/domain';
import { switchOrgAndOpen } from '@/app/(app)/actions';
import { ToastCard } from './toast-card';

const AUTO_DISMISS_MS = 6000;

/** Mounted once in the app shell. Subscribes to notification INSERTs for the
 *  signed-in user (RLS is user-scoped, so events from every org arrive on one
 *  channel), catches up the most recent unread on mount, and renders a
 *  self-dismissing stack. Clicking a toast opens its link, switching active org
 *  first when the event belongs to a different org. */
export function ToastHost({
  userId,
  activeOrgId,
  orgs,
}: {
  userId: string;
  activeOrgId: string;
  orgs: { orgId: string; name: string }[];
}) {
  const router = useRouter();
  const [stack, setStack] = useState<ToastModel[]>([]);

  // org_id -> { name } lookup; kept in a ref so the once-bound realtime callback
  // always reads the latest mapping.
  const orgsById = useMemo(
    () => Object.fromEntries(orgs.map((o) => [o.orgId, { name: o.name }])),
    [orgs],
  );
  const orgsRef = useRef(orgsById);
  orgsRef.current = orgsById;

  const push = useCallback((row: NotificationRow) => {
    setStack((prev) => enqueueToast(prev, notificationRowToToast(row, orgsRef.current)));
  }, []);

  const dismiss = useCallback((id: string) => {
    setStack((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Catch-up + live subscription.
  useEffect(() => {
    const supabase = createClient();
    let live = true;
    const channel = supabase.channel('notif-toasts');

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.access_token) supabase.realtime.setAuth(sess.session.access_token);

      // Catch-up: most recent unread, capped. RLS scopes to this user.
      const { data } = await supabase
        .from('notifications')
        .select('id, org_id, type, title, body, link')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(MAX_VISIBLE_TOASTS);
      if (live) {
        // reverse so the newest ends up on top after each prepend
        for (const r of ((data ?? []) as NotificationRow[]).slice().reverse()) push(r);
      }

      // Bail if the component unmounted while we awaited above — otherwise we'd
      // subscribe on a channel the cleanup already removed (a leaked subscription).
      if (!live) return;
      // Live inserts (dedup vs catch-up handled by enqueueToast's id check).
      channel
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          (payload) => push(payload.new as NotificationRow),
        )
        .subscribe();
    })();

    return () => {
      live = false;
      supabase.removeChannel(channel);
    };
  }, [userId, push]);

  const open = useCallback(
    (toast: ToastModel) => {
      // Best-effort mark-read so the bell/feed stay consistent.
      const supabase = createClient();
      void supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', toast.id);
      dismiss(toast.id);
      if (!toast.link) return;
      if (toast.orgId === activeOrgId) {
        router.push(toast.link);
      } else {
        void switchOrgAndOpen(toast.orgId, toast.link);
      }
    },
    [activeOrgId, dismiss, router],
  );

  const visible = stack.slice(0, MAX_VISIBLE_TOASTS);
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col gap-2 p-3 sm:inset-x-auto sm:right-0 sm:w-96">
      {visible.map((t) => (
        <AutoDismiss key={t.id} onExpire={() => dismiss(t.id)}>
          <ToastCard toast={t} onOpen={() => open(t)} onDismiss={() => dismiss(t.id)} />
        </AutoDismiss>
      ))}
    </div>
  );
}

/** Wraps a toast, auto-dismissing it after AUTO_DISMISS_MS. Hovering pauses the
 *  timer (it restarts fresh on leave). pointer-events-auto re-enables clicks that
 *  the pointer-events-none container disabled. */
function AutoDismiss({ children, onExpire }: { children: ReactNode; onExpire: () => void }) {
  const [paused, setPaused] = useState(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => expireRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [paused]);
  return (
    <div
      className="pointer-events-auto"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {children}
    </div>
  );
}
