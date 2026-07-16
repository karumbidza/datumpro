import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

/** The field app's Supabase client. Sessions persist in AsyncStorage and refresh
 *  automatically; RLS still governs every query (same policies as the web app). */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** The signed-in user from the LOCAL session — no network round-trip, unlike
 *  auth.getUser() which validates the JWT against the auth server on every call.
 *  RLS still enforces auth server-side on every query, so reads stay secure. */
export async function currentUser() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user ?? null;
}
