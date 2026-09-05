'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Bell } from '@/components/icons';

/** Sidebar bell — shows the caller's unread notification count (RLS-scoped) and
 *  links to the notifications feed. Event-driven: reloads on realtime INSERTs,
 *  navigation and window focus, with a slow safety poll as backstop. */
export function NotificationsBell() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  const load = useCallback(async () => {
    const supabase = createClient();
    const { count: c } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);
    setCount(c ?? 0);
  }, []);

  // Re-check when navigating (e.g. after visiting /notifications marks them read).
  useEffect(() => {
    void load();
  }, [pathname, load]);

  // Live refresh: subscribe to notification INSERTs for the signed-in user
  // (same pattern as ToastHost) instead of hammering a 30s poll. A 5-minute
  // safety poll + focus refresh cover missed events (sleep, dropped socket).
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const channel = supabase.channel('notif-bell');

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!active || !userId) return;
      if (sess.session?.access_token) supabase.realtime.setAuth(sess.session.access_token);
      channel
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          () => void load(),
        )
        .subscribe();
    })();

    const iv = setInterval(() => void load(), 300_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      clearInterval(iv);
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(channel);
    };
  }, [load]);

  return (
    <Link
      href="/notifications"
      title="Notifications"
      className="relative flex items-center rounded px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
    >
      <Bell size={16} />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
