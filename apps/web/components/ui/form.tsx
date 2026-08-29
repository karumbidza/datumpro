import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * The one canonical form recipe. Import these strings when a file renders raw
 * elements (server components, existing forms), or use the thin components
 * below in new code. Never re-declare a local inputClass.
 */
export const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/25 dark:border-zinc-800';

/** Dense tables/inline rows — same recipe, tighter padding. */
export const inputCompactClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/25 dark:border-zinc-800';

export const labelClass = 'mb-1 block text-sm font-medium';

/** Required-field marker. Append inside a <label> after the label text. */
export function Req() {
  return <span className="ml-0.5 text-red-500" aria-hidden="true" title="Required">*</span>;
}

/** Helper line under a field — tier-2 muted. zinc-500 on light meets WCAG AA
 *  contrast (zinc-400 did not); zinc-400 on the dark surface also passes. */
export const hintClass = 'mt-1 text-xs text-zinc-500 dark:text-zinc-400';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClass} ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputClass} ${className}`} {...props} />;
}

export function Label({ className = '', ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`${labelClass} ${className}`} {...props} />;
}
