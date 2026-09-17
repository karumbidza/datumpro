import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// One response for every input so existing vs non-existing accounts are
// indistinguishable (audit UB-AUD-1709 #5 — no user enumeration). The in-app
// reset flow lives on /sign-in via the Supabase SDK; this canonical endpoint
// exists so any direct probe of /api/forgot-password gets the same neutral 200.
const GENERIC = {
  message: 'If an account exists for that email, a password reset link is on its way.',
} as const;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email && EMAIL_RE.test(email)) {
      const supabase = await createClient();
      // Best-effort; the result is ignored so the response never varies by whether
      // the account exists. Supabase Auth applies its own send rate limits.
      await supabase.auth.resetPasswordForEmail(email).catch(() => {});
    }
  } catch {
    // Swallow everything: the response must not differ based on the input.
  }
  return NextResponse.json(GENERIC, { status: 200, headers: NO_STORE });
}

// Any other method/probe gets the same uniform, enumeration-safe response.
export function GET() {
  return NextResponse.json(GENERIC, { status: 200, headers: NO_STORE });
}
