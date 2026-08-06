/**
 * A visible reminder that the legal pages need a lawyer's review and have a
 * couple of bracketed facts to fill. Renders in development/preview only — it
 * returns null in production so it can't ship to end users. Remove the pages'
 * placeholders and get sign-off before going live.
 */
export function DraftNotice() {
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <div className="mb-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <strong>Draft — not yet legal-reviewed.</strong> This page is a stack-accurate starting point,
      not legal advice. Have a qualified lawyer review it and fill the remaining{' '}
      <code>[bracketed]</code> fact (company registration number) before publishing. This notice is
      hidden in production.
    </div>
  );
}
