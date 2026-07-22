import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { listRequestsByProject } from '@/lib/data/requests';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LiveRefresh } from '@/components/live-refresh';
import { formatUsd, type RequestStatus } from '@datumpro/shared/domain';

const STATUS_TONE: Record<RequestStatus, 'green' | 'blue' | 'amber' | 'neutral'> = {
  approved: 'green',
  submitted: 'blue',
  rejected: 'amber',
  draft: 'neutral',
  cancelled: 'neutral',
};

export default async function RequestsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  const requests = await listRequestsByProject(projectId);

  return (
    <PageContainer width="3xl">
      <LiveRefresh
        subscriptions={[
          { table: 'requests', filter: `project_id=eq.${projectId}` },
          { table: 'approvals', filter: `org_id=eq.${project.org_id}` },
        ]}
      />
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
            ← {project.name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Requests</h1>
        </div>
        <Link href={`/projects/${projectId}/requests/new`}>
          <Button>New request</Button>
        </Link>
      </header>

      {requests.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No requests yet.</p>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => (
            <li key={r.id}>
              <Link href={`/projects/${projectId}/requests/${r.id}`}>
                <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                  <div>
                    <p className="text-sm font-medium">
                      <span className="mr-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] uppercase text-zinc-500 dark:bg-zinc-800">
                        {r.type}
                      </span>
                      {r.title}
                    </p>
                    {r.amount_cents != null && (
                      <p className="mt-1 text-xs text-zinc-400">{formatUsd(r.amount_cents)}</p>
                    )}
                  </div>
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
