'use client';

import { useEffect } from 'react';

/** Registers the service worker on load so the app is installable (and push can
 *  attach later). The SW itself does no fetch caching — it only handles push and
 *  notification clicks — so registering everywhere is safe. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* registration is best-effort; the app works without it */
    });
  }, []);
  return null;
}
