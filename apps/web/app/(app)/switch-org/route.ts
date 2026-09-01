import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getActiveContext, ACTIVE_ORG_COOKIE } from '@/lib/data/org';

/** Set the active org — only ever to one the user actually belongs to — and
 *  continue to `next`. Used to align the active-org context when a member opens a
 *  project that lives in a different org (deep link / notification), so the app
 *  never renders a project outside its own org's context. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = req.nextUrl.searchParams.get('org');
  const nextParam = req.nextUrl.searchParams.get('next') || '/dashboard';
  // Only same-origin relative paths are valid redirect targets (no open redirect).
  const safeNext = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard';

  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.redirect(new URL('/sign-in', req.url));

  if (org && ctx.memberships.some((m) => m.orgId === org)) {
    (await cookies()).set(ACTIVE_ORG_COOKIE, org, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }
  return NextResponse.redirect(new URL(safeNext, req.url));
}
