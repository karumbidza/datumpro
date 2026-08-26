import { notFound, redirect } from 'next/navigation';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { getBoqDetail } from '@/lib/data/boq';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { BoqImporter } from './boq-importer';

export default async function BoqImportPage({ params }: { params: Promise<{ boqId: string }> }) {
  const { boqId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  if (!['owner', 'admin', 'pm'].includes(ctx.active.role)) redirect(`/boq/${boqId}`);

  const boq = await getBoqDetail(ctx.active.orgId, boqId);
  if (!boq) notFound();

  return (
    <PageContainer width="6xl">
      <PageHeader
        backHref={`/boq/${boqId}`}
        backLabel={boq.name}
        title="Import from Excel"
        subtitle={
          <>
            Upload a bill in any layout, tell DatumPro which column is which, review, then import into{' '}
            <span className="font-medium text-brand-600 dark:text-brand-500">{boq.name}</span>.
          </>
        }
      />

      <BoqImporter boqId={boqId} currency={boq.currency} />
    </PageContainer>
  );
}
