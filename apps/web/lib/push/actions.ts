'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** A browser PushSubscription serialized for transport. */
export interface WebPushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return { supabase, user };
}

/** Register (or refresh) this browser as a Web Push target for the current user.
 *  Idempotent on (user_id, endpoint) — RLS ensures a user can only write its own. */
export async function savePushSubscription(sub: WebPushSubscriptionInput) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      platform: 'web',
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: sub.userAgent ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint' },
  );
  if (error) throw new Error(error.message);
}

/** Drop this browser's subscription (user turned notifications off / signed out). */
export async function deletePushSubscription(endpoint: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint);
  if (error) throw new Error(error.message);
}
