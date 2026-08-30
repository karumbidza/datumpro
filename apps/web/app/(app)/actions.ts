'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE } from '@/lib/data/org';

/** Switch the active organisation (sets a year-long cookie the server reads). */
export async function setActiveOrg(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (orgId) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }
  redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}

/** Switch the active org AND land on a specific in-app link — used by cross-org
 *  notification toasts so a click drops you into the event in the right org
 *  context. Only same-origin app paths are allowed (open-redirect guard). */
export async function switchOrgAndOpen(orgId: string, link: string) {
  // Reject anything that isn't a plain in-app path (blocks "//evil.com" and
  // absolute URLs); fall back to the dashboard.
  const target = link.startsWith('/') && !link.startsWith('//') ? link : '/dashboard';
  if (orgId) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }
  redirect(target);
}
