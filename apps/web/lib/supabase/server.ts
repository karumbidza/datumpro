import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/** Server-side Supabase client bound to the request's cookies. Use this in Server
 *  Components, Route Handlers, and Server Actions. RLS still applies — this is the
 *  authenticated user's client, not a privileged one. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` called from a Server Component — safe to ignore; the
          // middleware refreshes the session cookie on the next request.
        }
      },
    },
  });
}
