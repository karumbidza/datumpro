/** Instant fallback while an app route's server component streams in. */
export default function Loading() {
  return (
    <div className="flex h-full items-center justify-center py-24">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-600"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
