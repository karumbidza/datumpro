import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env } from '@/lib/env';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** Refreshes the Supabase session cookie on every request and gates the
 *  authenticated app area. Unauthed users hitting /dashboard|/projects|/finance
 *  are redirected to /sign-in. */
export async function middleware(request: NextRequest) {
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

  const protectedPrefixes = ['/dashboard', '/projects', '/finance', '/requests', '/orgs'];
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
