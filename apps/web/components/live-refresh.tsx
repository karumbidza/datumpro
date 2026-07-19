'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export type LiveSub = { table: string; filter?: string };

/** Live-refresh the current route when the given tables change. Drop it into a
 *  Server Component page with the tables that page reads (filtered to the current
 *  project/task). On any insert/update/delete, it calls router.refresh() —
 *  re-fetching the RSC — so every open tab (and every teammate) sees the change
 *  without a manual reload, the same way chat updates. RLS is enforced on the
 *  realtime connection, so a client only receives changes to rows it can see.
 *
 *  Renders nothing. Debounced so a burst of changes triggers a single refresh. */
export function LiveRefresh({ subscriptions }: { subscriptions: LiveSub[] }) {
  const router = useRouter();
  // Serialise the subscription set so the effect only re-subscribes when it
  // actually changes (arrays get a new identity every render).
  const key = JSON.stringify(subscriptions);

  useEffect(() => {
    const subs: LiveSub[] = JSON.parse(key);
    if (subs.length === 0) return;
    const supabase = createClient();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) router.refresh();
      }, 350);
    };

    const channel = supabase.channel(`live:${key}`);
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      for (const s of subs) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) },
          refresh,
        );
      }
      channel.subscribe();
    })();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [key, router]);

  return null;
}
