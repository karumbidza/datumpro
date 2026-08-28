'use client';

import { useEffect } from 'react';
import { captureException } from '@/lib/observability/sentry';
import { Button } from '@/components/ui/button';

/** Route-segment error boundary. Reports the error, then offers a retry. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void captureException(error, { digest: error.digest, boundary: 'route' });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">Something went wrong</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        An unexpected error interrupted this page. If it keeps happening, let us know.
      </p>
      <Button onClick={reset} className="mt-5">
        Try again
      </Button>
    </main>
  );
}
