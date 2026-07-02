/** Public config for the field app. Expo inlines EXPO_PUBLIC_* at build time.
 *  Set these in apps/mobile/.env (see .env.example) or the EAS build profile. */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Don't crash the bundler — surface a clear runtime hint instead.
  console.warn('[env] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set.');
}
