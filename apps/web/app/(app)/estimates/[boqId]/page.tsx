import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { getBoqDetail } from '@/lib/data/boq';
import { PageContainer } from '@/components/shell/page-container';
import { BoqBuilder } from './boq-builder';

export default async function BoqPage({ params }: { params: Promise<{ boqId: string }> }) {
  const { boqId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');

  const boq = await getBoqDetail(ctx.active.orgId, boqId);
  if (!boq) notFound();

  const canEdit = ['owner', 'admin', 'pm'].includes(ctx.active.role);

  return (
    <PageContainer width="6xl">
      <Link href="/estimates" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
        ← Estimates
      </Link>
      <BoqBuilder boq={boq} canEdit={canEdit} />
    </PageContainer>
  );
}
