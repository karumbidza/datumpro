import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client for trusted server jobs (cron scans, fan-outs). It BYPASSES
 * Row-Level Security, so it must only ever run in server-only code paths that are
 * themselves access-controlled (e.g. a CRON_SECRET-guarded route) — never behind a
 * user request without an explicit authority check.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
