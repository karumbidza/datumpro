import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/data/org';
import { getInvitationPreview } from '@/lib/data/org-members';
import { MEMBER_TYPE_META } from '@datumpro/shared/access';
import { acceptInvitation, signOutToSwitch } from './actions';
import { ProfileSetupForm } from './profile-setup-form';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const user = await getAuthUser();
  const preview = await getInvitationPreview(token);

  // First-time invitees get the full profile setup; anyone who already has a
  // handle just accepts. (Profile rows exist from the auth trigger.)
  let profile: { username: string | null; display_name: string | null } | null = null;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('profiles')
      .select('username, display_name')
      .eq('id', user.id)
      .maybeSingle();
    profile = data as { username: string | null; display_name: string | null } | null;
  }
  const needsSetup = !!user && !profile?.username;
  // Signed in with a different address than the one invited — the accept RPC
  // would reject it, so we surface a clear switch-account step instead of a form.
  const wrongEmail = !!user?.email && !!preview && user.email.toLowerCase() !== preview.email.toLowerCase();
  const typeMeta = preview ? MEMBER_TYPE_META[preview.memberType] : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <Card>
        {!preview ? (
          <>
            <CardTitle>Invitation not found</CardTitle>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              This invitation link is invalid. Ask the person who invited you to send a new one.
            </p>
          </>
        ) : preview.status !== 'pending' ? (
          <>
            <CardTitle>Invitation already {preview.status}</CardTitle>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              This invitation to <strong>{preview.orgName}</strong> is no longer active.
            </p>
            <Link href="/dashboard" className="mt-4 inline-block text-sm text-brand-600 dark:text-brand-400 hover:underline">
              Go to dashboard →
            </Link>
          </>
        ) : (
          <>
            <CardTitle>Join {preview.orgName}</CardTitle>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {needsSetup ? (
                <>
                  Invited as <strong>{typeMeta?.label ?? preview.role}</strong> — set up your profile
                  to continue.
                </>
              ) : (
                <>
                  You’ve been invited to <strong>{preview.orgName}</strong> as{' '}
                  {typeMeta?.label ?? preview.role}, at <span className="font-medium">{preview.email}</span>.
                </>
              )}
            </p>

            {error && (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10">
                {error}
              </p>
            )}

            {user && wrongEmail ? (
              <div className="mt-4">
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  You&apos;re signed in as <span className="font-medium">{user.email}</span>, but this invite was sent
                  to <span className="font-medium">{preview.email}</span>. Switch to that account to accept.
                </p>
                <form action={signOutToSwitch} className="mt-3">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="email" value={preview.email} />
                  <SubmitButton pendingText="Switching…">Sign out &amp; switch account</SubmitButton>
                </form>
              </div>
            ) : user && needsSetup ? (
              <ProfileSetupForm
                token={token}
                email={preview.email}
                userId={user.id}
                initialName={profile?.display_name ?? ''}
                roleLabel={typeMeta?.label ?? preview.role}
                roleHint={typeMeta?.hint ?? ''}
                orgName={preview.orgName}
                isContractor={preview.memberType === 'contractor'}
              />
            ) : user ? (
              <form action={acceptInvitation} className="mt-4">
                <input type="hidden" name="token" value={token} />
                <SubmitButton pendingText="Joining…">Accept invitation</SubmitButton>
              </form>
            ) : (
              <div className="mt-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Continue as <span className="font-medium">{preview.email}</span>. New here? Create your account on
                  the next screen — the same address works for sign-in and sign-up.
                </p>
                <Link
                  href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(preview.email)}`}
                  className="mt-3 inline-block"
                >
                  <Button type="button">Sign in or create account</Button>
                </Link>
              </div>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
