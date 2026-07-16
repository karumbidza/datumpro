/** Inline form error banner. Pairs with server actions that return
 *  `{ error }` via useActionState instead of throwing to the error boundary. */
export type FormState = { error?: string };

export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400"
    >
      {error}
    </p>
  );
}
