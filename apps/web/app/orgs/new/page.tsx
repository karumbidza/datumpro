import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createOrg } from '../actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function NewOrgPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <h1 className="text-lg font-semibold tracking-tight">Create your organisation</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          You&apos;ll be the owner. Add projects and teammates next.
        </p>
        <form action={createOrg} className="mt-6 space-y-3">
          <input name="name" required placeholder="e.g. Grafaid Engineers" className={inputClass} />
          <Button type="submit" className="w-full">
            Create organisation
          </Button>
        </form>
      </Card>
    </main>
  );
}
