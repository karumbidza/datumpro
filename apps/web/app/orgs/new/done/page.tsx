import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { Card } from '@/components/ui/card';

export default async function OrgCreatedPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-10">
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Step 2 of 2 · You&apos;re set up</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Your company is ready</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Two quick things get your team working. You can also do these later from the dashboard.
        </p>

        <div className="mt-6 space-y-3">
          <Link
            href="/org/members"
            className="block rounded-md border border-zinc-200 px-4 py-3 text-sm hover:border-brand-500 dark:border-zinc-800"
          >
            <span className="font-medium">Invite your team →</span>
            <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
              Add teammates, contractors, or clients by email.
            </span>
          </Link>
          <Link
            href="/projects/new"
            className="block rounded-md border border-zinc-200 px-4 py-3 text-sm hover:border-brand-500 dark:border-zinc-800"
          >
            <span className="font-medium">Create your first project →</span>
            <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
              Set up a project to start tracking work and finance.
            </span>
          </Link>
        </div>

        <Link
          href="/dashboard"
          className="mt-6 block text-center text-sm text-zinc-500 underline dark:text-zinc-400"
        >
          Skip to dashboard
        </Link>
      </Card>
    </main>
  );
}
