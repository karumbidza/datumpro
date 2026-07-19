import { useEffect } from 'react';
import { supabase } from './supabase';

/** One table to watch, optionally narrowed to rows matching a Postgres filter
 *  (e.g. `task_id=eq.<id>`). Mirrors the web LiveRefresh subscription shape. */
export interface LiveSub {
  table: string;
  filter?: string;
}

/** Live-refresh a mobile screen while it's open. Pass the realtime tables the
 *  screen reads (scoped to the ids in view) plus the screen's existing reload
 *  callback; on any insert/update/delete to a matching row it calls `onChange` —
 *  so the screen stays current without waiting for the next focus, the same way
 *  chat updates. RLS is enforced on the realtime connection, so a client only
 *  receives changes to rows it can already see.
 *
 *  Debounced ~400ms so a burst of changes triggers a single reload. No-ops when
 *  `subscriptions` is empty (guard the array until the needed ids exist). */
export function useLiveRefresh(subscriptions: LiveSub[], onChange: () => void): void {
  // Serialise the subscription set so the effect only re-subscribes when it
  // actually changes (arrays get a new identity every render).
  const key = JSON.stringify(subscriptions);

  useEffect(() => {
    const subs: LiveSub[] = JSON.parse(key);
    if (subs.length === 0) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) onChange();
      }, 400);
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
    // onChange is intentionally omitted: callers pass a stable useCallback `load`,
    // and re-subscribing on every render would tear down the channel needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
