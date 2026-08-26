import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { NewReportForm } from './new-report-form';
import { Card } from '@/components/ui/card';

export default async function NewReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const today = new Date().toISOString().slice(0, 10);

  return (
    <PageContainer width="xl">
      <PageHeader
        backHref={`/projects/${projectId}`}
        backLabel="Back to project"
        title="New site report"
      />

      <Card className="mt-6">
        <NewReportForm projectId={projectId} today={today} />
      </Card>
    </PageContainer>
  );
}
