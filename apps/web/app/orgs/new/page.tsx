import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { createOrg } from '../actions';
import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { isBusinessEmail } from '@datumpro/shared/validation';

import { inputClass } from '@/components/ui/form';

export default async function NewOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const { error } = await searchParams;
  const message = error ? decodeURIComponent(error) : null;
  // Non-blocking nudge only — the org is created regardless (see spec §0/§7).
  const personalEmail = !!user.email && !isBusinessEmail(user.email);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">Step 1 of 2 · Your company</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Set up your company</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          This is your tenant — you&apos;ll be the owner. A short profile keeps your workspace on record and
          credible for the teams and clients you invite.
        </p>

        {personalEmail && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            You&apos;re signed in with a personal email. A work address (you@yourcompany.com) looks more credible
            to the teams and clients you&apos;ll invite — but you can continue either way.
          </p>
        )}

        {message && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            {message}
          </p>
        )}

        <form action={createOrg} className="mt-6 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Company name</label>
            <input name="name" required placeholder="e.g. Acme Construction" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Legal / registered name <span className="text-zinc-500 dark:text-zinc-400">(optional)</span>
            </label>
            <input name="legalName" placeholder="e.g. Acme Construction (Private) Limited" className={inputClass} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium">
                Country <span className="text-zinc-500 dark:text-zinc-400">(optional)</span>
              </label>
              <input name="country" placeholder="e.g. Zimbabwe" className={inputClass} />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium">
                Sector <span className="text-zinc-500 dark:text-zinc-400">(optional)</span>
              </label>
              <select name="sector" defaultValue="" className={inputClass}>
                <option value="">Select…</option>
                <option value="construction">Construction</option>
                <option value="corporate">Corporate / Private</option>
                <option value="ngo">NGO / Non-profit</option>
                <option value="government">Government</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Registration number <span className="text-zinc-500 dark:text-zinc-400">(optional)</span>
            </label>
            <input name="registrationNumber" placeholder="Company / entity reg. number" className={inputClass} />
          </div>
          <SubmitButton className="w-full" pendingText="Creating…">
            Create company
          </SubmitButton>
        </form>
      </Card>
    </main>
  );
}
