import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createProject } from '../actions';
import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href="/projects" className="text-xs text-zinc-500 hover:underline">
        ← Projects
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New project</h1>

      <Card className="mt-6">
        <form action={createProject} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Project name</label>
            <input name="name" required placeholder="e.g. Riverside Office Block" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Client</label>
            <input name="clientName" placeholder="Client name" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Contract value (USD)</label>
            <input type="number" name="contractValue" min={0} step="0.01" defaultValue={0} className={inputClass} />
          </div>
          <div className="pt-2">
            <SubmitButton pendingText="Creating…">Create project</SubmitButton>
          </div>
        </form>
      </Card>
    </main>
  );
}
