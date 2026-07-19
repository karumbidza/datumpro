import Link from 'next/link';
import { getAuthUser } from '@/lib/data/org';
import { getInvitationPreview } from '@/lib/data/org-members';
import { acceptInvitation } from './actions';
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
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
            <Link href="/dashboard" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
              Go to dashboard →
            </Link>
          </>
        ) : (
          <>
            <CardTitle>Join {preview.orgName}</CardTitle>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              You’ve been invited to <strong>{preview.orgName}</strong> as {preview.role}, at{' '}
              <span className="font-medium">{preview.email}</span>.
            </p>

            {error && (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10">
                {error}
              </p>
            )}

            {user ? (
              <form action={acceptInvitation} className="mt-4">
                <input type="hidden" name="token" value={token} />
                <SubmitButton pendingText="Joining…">Accept invitation</SubmitButton>
                {user.email && user.email.toLowerCase() !== preview.email.toLowerCase() && (
                  <p className="mt-2 text-xs text-amber-600">
                    You’re signed in as {user.email}. This invite was sent to {preview.email} — sign in
                    with that address to accept.
                  </p>
                )}
              </form>
            ) : (
              <div className="mt-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Continue with <span className="font-medium">{preview.email}</span> to accept. New
                  to DatumPro? Create your account on the next screen — sign-in and sign-up both use
                  this address.
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
