'use client';

import { env } from '@/lib/env';
import { savePushSubscription, deletePushSubscription } from './actions';

/** Whether this browser can do Web Push at all, and we have a VAPID key to use. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    !!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  );
}

/** VAPID keys are URL-safe base64; the PushManager wants raw bytes. Returns a
 *  fresh ArrayBuffer (not a view) so it satisfies BufferSource exactly. */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

async function ready(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready.then(() => reg);
}

function serialize(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    userAgent: navigator.userAgent,
  };
}

export type PushState = 'unsupported' | 'denied' | 'default' | 'subscribed';

/** Current state without prompting. */
export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) return 'subscribed';
  } catch {
    /* fall through */
  }
  return Notification.permission === 'granted' ? 'default' : 'default';
}

/** Ask permission (if needed), subscribe, and persist. Returns the new state. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

  const reg = await ready();
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    }));
  await savePushSubscription(serialize(sub));
  return 'subscribed';
}

/** Unsubscribe this browser and forget it server-side. */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await deletePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'default';
}
