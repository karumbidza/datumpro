'use client';

import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/** Browser-side Supabase client. Safe to expose — uses the anon key and is
 *  governed by Row-Level Security. */
export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
