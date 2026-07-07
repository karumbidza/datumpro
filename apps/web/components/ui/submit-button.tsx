'use client';

import { type ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from './button';

/**
 * A form submit button that reflects the enclosing form's pending state — shows
 * a spinner and disables itself while the server action runs, so every action
 * has immediate click feedback. Drop-in replacement for `<Button type="submit">`
 * inside a `<form action={...}>`.
 */
export function SubmitButton({
  children,
  pendingText,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" aria-busy={pending} disabled={pending || disabled} {...props}>
      {pending && <Spinner />}
      {pending ? pendingText ?? children : children}
    </Button>
  );
}

function Spinner() {
  return (
    <svg className="mr-2 h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
