'use client';

import { useEffect } from 'react';
import { captureException } from '@/lib/observability/sentry';

/** Route-segment error boundary. Reports the error, then offers a retry. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void captureException(error, { digest: error.digest, boundary: 'route' });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">Something went wrong</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        An unexpected error interrupted this page. You can try again — if it keeps happening, let us
        know.
      </p>
      <button
        onClick={reset}
        className="mt-5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Try again
      </button>
    </main>
  );
}
