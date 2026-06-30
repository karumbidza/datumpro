import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { createRequest } from '../actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { REQUEST_TYPES } from '@datumpro/shared/domain';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function NewRequestPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href={`/projects/${projectId}/requests`} className="text-xs text-zinc-500 hover:underline">
        ← Requests
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New request</h1>

      <Card className="mt-6">
        <form action={createRequest} className="space-y-4">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Type</label>
              <select name="type" defaultValue="rfi" className={inputClass}>
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Amount (USD, if any)</label>
              <input name="amount" type="number" step="0.01" placeholder="0.00" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Title</label>
            <input name="title" required placeholder="Short summary" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <textarea name="description" rows={4} className={inputClass} />
          </div>
          <div className="pt-2">
            <Button type="submit">Create request</Button>
          </div>
          <p className="text-xs text-zinc-400">
            Saved as a draft — submit it on the next screen to start the approval chain.
          </p>
        </form>
      </Card>
    </main>
  );
}
