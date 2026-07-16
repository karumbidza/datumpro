'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Bell } from '@/components/icons';

/** Sidebar bell — polls the caller's unread notification count (RLS-scoped) and
 *  links to the notifications feed. */
export function NotificationsBell() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const load = async () => {
      const { count: c } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (active) setCount(c ?? 0);
    };
    void load();
    const iv = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(iv);
    };
    // Re-check when navigating (e.g. after visiting /notifications marks them read).
  }, [pathname]);

  return (
    <Link
      href="/notifications"
      title="Notifications"
      className="relative flex items-center rounded px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
    >
      <Bell size={16} />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[9px] font-semibold text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
