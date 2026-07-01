/** Fail-fast environment access. Importing a missing public var throws at module
 *  load instead of producing a confusing runtime error deep in a request. */
import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  // Web Push VAPID public key. Optional — when unset, push is simply not offered
  // (the notification bell hides itself).
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional().default(''),
});

// Supabase renamed the browser key: legacy `anon` → new `sb_publishable_…`.
// Accept either env var name so both the old and new dashboards' snippets work.
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const env = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
});
