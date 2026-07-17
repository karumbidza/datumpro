import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NewReportForm } from './new-report-form';
import { Card } from '@/components/ui/card';

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
        <NewReportForm projectId={projectId} today={today} />
      </Card>
    </main>
  );
}
