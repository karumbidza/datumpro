import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { listBudgetBilling } from '@/lib/data/finance';
import { createInvoice } from '../../actions';
import { InvoiceForm } from '@/components/finance/invoice-form';
import { Card } from '@/components/ui/card';

export default async function NewInvoicePage({
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

  const budgetLines = await listBudgetBilling(projectId);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/projects/${projectId}/finance`} className="text-xs text-zinc-500 hover:underline">
        ← Finance
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New invoice</h1>
      <Card className="mt-6">
        <InvoiceForm action={createInvoice} projectId={projectId} budgetLines={budgetLines} />
      </Card>
    </main>
  );
}
