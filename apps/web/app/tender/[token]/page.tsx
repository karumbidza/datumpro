import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/data/org';
import { getBidWorkspace } from '@/lib/data/tender';
import { Card, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/shell/page-container';
import { BidWorkspaceView } from './bid-workspace';

export default async function TenderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const user = await getAuthUser();
  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/tender/${token}`)}`);
  }

  // Claim (or re-claim) the bidder row for the signed-in user.
  const supabase = await createClient();
  const { data: tenderId, error: rpcError } = await supabase.rpc('accept_boq_bid_invite', {
    p_token: token,
  });

  if (rpcError) {
    const msg = rpcError.message ?? '';
    const isWrongEmail = /different email/i.test(msg);
    const isInvalid = /not found|withdrawn/i.test(msg);

    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
        <Card>
          {isWrongEmail ? (
            <>
              <CardTitle>Wrong account</CardTitle>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                This invitation was sent to a different email address. Sign out and sign in with the
                address that received the tender invite.
              </p>
            </>
          ) : isInvalid ? (
            <>
              <CardTitle>Invitation is no longer valid</CardTitle>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                This tender invitation has been withdrawn or does not exist. Contact the project
                owner for a new invite.
              </p>
            </>
          ) : (
            <>
              <CardTitle>Something went wrong</CardTitle>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                Unable to open this tender invitation. Try again, or contact the project owner.
              </p>
            </>
          )}
        </Card>
      </main>
    );
  }

  // tenderId is returned by the RPC but we load the full workspace via token so
  // RLS self-read scoping applies consistently.
  void tenderId;

  const ws = await getBidWorkspace(token);
  if (!ws) notFound();

  return (
    <PageContainer width="6xl">
      <BidWorkspaceView ws={ws} token={token} viewerEmail={user.email ?? null} />
    </PageContainer>
  );
}
