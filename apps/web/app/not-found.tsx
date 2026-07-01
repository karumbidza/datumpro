import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-white">404</p>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        We couldn’t find that page. It may have moved, or you may not have access to it.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
