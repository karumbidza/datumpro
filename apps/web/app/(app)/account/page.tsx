import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { updateDisplayName } from './actions';
import { signOut } from '@/app/(app)/actions';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function AccountPage() {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const [{ data: profile }, ctx] = await Promise.all([
    supabase.from('profiles').select('display_name, email, company, phone').eq('id', user.id).single(),
    getActiveContext(),
  ]);
  const p = profile as {
    display_name: string | null;
    email: string | null;
    company: string | null;
    phone: string | null;
  } | null;

  return (
    <PageContainer width="lg">
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Account</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Your display name is shown on tasks, chat, and your team roster.
      </p>

      <Card className="mt-6">
        <CardTitle>Profile</CardTitle>
        <form action={updateDisplayName} className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Full name</label>
            <input
              name="displayName"
              defaultValue={p?.display_name ?? ''}
              placeholder="e.g. Alex Karumbidza"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Company</label>
            <input
              name="company"
              defaultValue={p?.company ?? ''}
              placeholder="e.g. Karumbidza Builders"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Phone</label>
            <input
              name="phone"
              type="tel"
              defaultValue={p?.phone ?? ''}
              placeholder="e.g. +263 77 123 4567"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Email</label>
            <input value={p?.email ?? user.email ?? ''} readOnly className={`${inputClass} opacity-60`} />
          </div>
          <Button type="submit">Save</Button>
        </form>
      </Card>

      {ctx?.memberships && ctx.memberships.length > 0 && (
        <Card className="mt-4">
          <CardTitle>Organisations</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {ctx.memberships.map((m) => (
              <li key={m.orgId} className="flex items-center justify-between">
                <span className="text-zinc-700 dark:text-zinc-300">{m.name}</span>
                <span className="text-xs text-zinc-400">{m.role}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <form action={signOut} className="mt-6">
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </PageContainer>
  );
}
