import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** Minimal public landing — the real marketing site can replace this later. */
export default function HomePage() {
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
