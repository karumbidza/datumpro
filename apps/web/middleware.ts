import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env } from '@/lib/env';
import { clientIp, rateLimit } from '@/lib/rate-limit';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** Per-IP edge rate limits for the machine-callable API surface. The
 *  bearer-guarded admin/support endpoints get a tighter cap so the secret can't
 *  be brute-forced by volume; other API routes get a general abuse ceiling.
 *  (App reads/writes are additionally protected by Supabase Auth limits + RLS,
 *  and the enterprise form is throttled in its RPC.) */
async function apiRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const path = request.nextUrl.pathname;
  if (!path.startsWith('/api/')) return null;

  const sensitive = path.startsWith('/api/admin') || path.startsWith('/api/support');
  const limit = sensitive ? 20 : 60; // requests per minute per IP
  const ip = clientIp(request.headers);
  const bucket = sensitive ? 'api-sensitive' : 'api';

  const { ok, remaining, reset } = await rateLimit(`${bucket}:${ip}`, limit, 60);
  if (ok) return null;

  return new NextResponse('Too Many Requests', {
    status: 429,
    headers: {
      'Retry-After': String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(remaining),
    },
  });
}

/** Refreshes the Supabase session cookie on every request and gates every
 *  authenticated area (see `protectedPrefixes`). Unauthed users hitting a
 *  protected path are redirected to /sign-in with a `?next=` back-link. */
export async function middleware(request: NextRequest) {
  // Rate limit the API surface before any session work.
  const limited = await apiRateLimit(request);
  if (limited) return limited;

  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Gate on the LOCAL session (getSession) rather than getUser(): getUser makes a
  // network round-trip to the auth server on every request, while getSession reads
  // the cookie and only refreshes when the token is expired. This is a gate, not a
  // trust boundary — RLS still validates the JWT on every data access.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Every authenticated area. Kept in sync with the (app) route group plus the
  // top-level authed pages (/mfa, /orgs). '/org' also covers '/orgs' by prefix,
  // but both are listed to be self-documenting. This is the fast pre-gate; the
  // (app) layout + RLS remain the real trust boundary.
  const protectedPrefixes = [
    '/account',
    '/boq',
    '/dashboard',
    '/documents',
    '/finance',
    '/mfa',
    '/notifications',
    '/org',
    '/orgs',
    '/payments',
    '/projects',
    '/support',
    '/tender',
  ];
  const isProtected = protectedPrefixes.some((p) => request.nextUrl.pathname.startsWith(p));

  if (isProtected && !session) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
