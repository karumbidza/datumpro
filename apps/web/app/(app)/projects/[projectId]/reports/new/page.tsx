import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createReport } from '../actions';
import { WEATHER_OPTIONS } from '@datumpro/shared/domain';
import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

export default async function NewReportPage({
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

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
        ← Back to project
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New site report</h1>

      <Card className="mt-6">
        <form action={createReport} className="space-y-4">
          <input type="hidden" name="projectId" value={projectId} />

          <div>
            <label className="mb-1 block text-sm font-medium">Date</label>
            <input type="date" name="reportDate" defaultValue={today} required className={inputClass} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Progress (%)</label>
            <input
              type="number"
              name="progressPct"
              min={0}
              max={100}
              defaultValue={0}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Weather</label>
            <select name="weather" className={inputClass} defaultValue="">
              <option value="">—</option>
              {WEATHER_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Narrative</label>
            <textarea name="narrative" rows={5} className={inputClass} placeholder="What happened on site today?" />
          </div>

          <div className="flex gap-2 pt-2">
            <SubmitButton name="intent" value="submitted" pendingText="Submitting…">
              Submit report
            </SubmitButton>
            <SubmitButton name="intent" value="draft" variant="secondary" pendingText="Saving…">
              Save draft
            </SubmitButton>
          </div>
        </form>
      </Card>
    </main>
  );
}
