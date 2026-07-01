'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from '@/components/icons';
import {
  pushSupported,
  currentPushState,
  enablePush,
  disablePush,
  type PushState,
} from '@/lib/push/web-push';

/** A compact bell that lets the user turn browser push notifications on/off.
 *  Renders nothing when the browser can't do push or no VAPID key is configured,
 *  so it stays invisible until the feature is actually available. */
export function NotifyToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) {
      setState('unsupported');
      return;
    }
    void currentPushState().then(setState);
  }, []);

  if (state === null || state === 'unsupported') return null;

  const subscribed = state === 'subscribed';

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      setState(subscribed ? await disablePush() : await enablePush());
    } catch {
      // Leave the state as-is; a failed subscribe shouldn't wedge the UI.
    } finally {
      setBusy(false);
    }
  }

  const title =
    state === 'denied'
      ? 'Notifications are blocked in your browser settings'
      : subscribed
        ? 'Notifications on — click to turn off'
        : 'Get notified of new messages';

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || state === 'denied'}
      title={title}
      aria-label={title}
      className={`rounded p-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${
        subscribed ? 'text-brand-600' : 'text-zinc-400'
      }`}
    >
      {subscribed ? <Bell size={16} /> : <BellOff size={16} />}
    </button>
  );
}
