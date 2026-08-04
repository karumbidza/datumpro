'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE } from '@/lib/data/org';
import { getInvitationPreview } from '@/lib/data/org-members';
import { profileSetupSchema } from '@datumpro/shared/validation';

/** Accept an invitation: the DB RPC verifies token + email match, adds the
 *  membership, and returns the org id. We then make it the active org. */
export async function acceptInvitation(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  if (!token) redirect('/dashboard');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data, error } = await supabase.rpc('accept_org_invitation', { p_token: token });
  if (error) redirect(`/invite/${token}?error=${encodeURIComponent(error.message)}`);

  const orgId = data as string;
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  redirect('/dashboard');
}

interface SetupState {
  error?: string;
}

/** First-time invitees: save the profile-setup fields (username, name, phone,
 *  optional company/trade and avatar URLs — the avatar files were already
 *  uploaded client-side), then accept the invitation in the same submit. */
export async function completeProfileAndAccept(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const token = String(formData.get('token') ?? '');
  if (!token) redirect('/dashboard');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);

  const parsed = profileSetupSchema.safeParse({
    username: String(formData.get('username') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    companyName: String(formData.get('companyName') ?? ''),
    trade: String(formData.get('trade') ?? ''),
    avatarUrl: String(formData.get('avatarUrl') ?? ''),
    avatarThumbUrl: String(formData.get('avatarThumbUrl') ?? ''),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(' ') };
  }
  const d = parsed.data;

  // Contractors must name their company — it drives tender filtering.
  const preview = await getInvitationPreview(token);
  if (preview?.memberType === 'contractor' && !d.companyName) {
    return { error: 'Enter your company name.' };
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      username: d.username,
      display_name: d.fullName,
      phone: d.phone,
      company_name: d.companyName || null,
      trade: d.trade || null,
      ...(d.avatarUrl
        ? {
            avatar_url: d.avatarUrl,
            avatar_thumb_url: d.avatarThumbUrl || null,
            avatar_updated_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq('id', user.id);
  if (profileError) {
    // The unique index is the race-proof availability check.
    if (profileError.code === '23505') {
      return { error: `"${d.username}" was just taken — pick another username.` };
    }
    return { error: profileError.message };
  }

  const { data, error } = await supabase.rpc('accept_org_invitation', { p_token: token });
  if (error) return { error: error.message };

  const orgId = data as string;
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  redirect('/dashboard');
}
