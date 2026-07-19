import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { Button } from '@/components/ui/button';

/** Public landing. Signed-in users skip straight to their dashboard. */
export default async function HomePage() {
  const user = await getAuthUser();
  if (user) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">DatumPro</h1>
        <p className="mt-3 text-zinc-500 dark:text-zinc-400">
          Remote project monitoring, approvals, and finance — from one source of truth.
        </p>
        <p className="mt-1 text-xs text-zinc-400">by Grafaid Engineers</p>
      </div>
      <Link href="/sign-in">
        <Button>Sign in</Button>
      </Link>
    </main>
  );
}
