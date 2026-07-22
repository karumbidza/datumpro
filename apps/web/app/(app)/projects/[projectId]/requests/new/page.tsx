import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { NewRequestForm } from './new-request-form';
import { Card } from '@/components/ui/card';

export default async function NewRequestPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  return (
    <PageContainer width="xl">
      <Link href={`/projects/${projectId}/requests`} className="text-xs text-zinc-500 hover:underline">
        ← Requests
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New request</h1>

      <Card className="mt-6">
        <NewRequestForm projectId={projectId} />
      </Card>
    </PageContainer>
  );
}
