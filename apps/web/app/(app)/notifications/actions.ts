'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/** Mark all of the caller's notifications read. RLS scopes it to their own rows. */
export async function markAllNotificationsRead() {
  const supabase = await createClient();
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  revalidatePath('/notifications');
}
