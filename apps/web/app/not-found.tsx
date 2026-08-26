import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-white">404</p>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        We couldn’t find that page. It may have moved, or you may not have access to it.
      </p>
      <Link href="/dashboard" className="mt-5">
        <Button>Back to dashboard</Button>
      </Link>
    </main>
  );
}
