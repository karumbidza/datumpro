import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { getAuthUser } from '@/lib/data/org';
import { getProjectForEdit } from '@/lib/data/projects';
import { myOrgRole } from '@/lib/data/tasks';
import {
  listProjectMembers, listAddableOrgMembers, myProjectRole, myMemberType, redactContacts,
} from '@/lib/data/members';
import { getProjectSetup } from '@/lib/data/project-setup';
import { listClients } from '@/lib/data/clients';
import { LiveRefresh } from '@/components/live-refresh';
import { ProgressTab } from './progress-tab';
import { DetailsTab } from './details-tab';
import { CommercialTab } from './commercial-tab';
import { TeamTab } from './team-tab';
import { StatusTab } from './status-tab';

const TABS = [
  { key: 'progress', label: 'Progress' },
  { key: 'details', label: 'Details' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'team', label: 'Team' },
  { key: 'status', label: 'Status' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default async function ProjectSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string; error?: string; saved?: string; added?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? 'progress');

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProjectForEdit(projectId);
  if (!project) notFound();

  const [orgRole, projectRole, setup] = await Promise.all([
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    getProjectSetup(projectId),
  ]);
  const canManage = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
  if (!canManage) redirect(`/projects/${projectId}`);

  const notice = sp.error
    ? { kind: 'error' as const, text: decodeURIComponent(sp.error) }
    : sp.saved || sp.added
      ? { kind: 'ok' as const, text: sp.added ? 'Added to the project.' : 'Saved.' }
      : null;

  // Per-tab data.
  const clients = tab === 'details' ? await listClients(project.org_id) : [];
  let members = [] as Awaited<ReturnType<typeof listProjectMembers>>;
  let addable = [] as Awaited<ReturnType<typeof listAddableOrgMembers>>;
  if (tab === 'team') {
    const [raw, viewerType, add] = await Promise.all([
      listProjectMembers(projectId),
      myMemberType(project.org_id),
      listAddableOrgMembers(project.org_id, projectId),
    ]);
    members = redactContacts(viewerType, raw);
    addable = add;
  }

  return (
    <PageContainer width="3xl">
      {tab === 'team' && (
        <LiveRefresh subscriptions={[{ table: 'project_members', filter: `project_id=eq.${projectId}` }]} />
      )}
      <PageHeader
        backHref={`/projects/${projectId}`}
        backLabel={project.name}
        title="Project set up"
        subtitle="Edit this project’s details, team and setup."
      />

      {/* Tab bar */}
      <div className="mt-6 border-b border-zinc-200 dark:border-zinc-800">
        <nav className="-mb-px flex gap-5 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Link
                key={t.key}
                href={`/projects/${projectId}/settings?tab=${t.key}`}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-brand-500 text-zinc-900 dark:text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {notice && (
        <p
          className={`mt-4 rounded-md px-3 py-2 text-sm ${
            notice.kind === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
              : 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="mt-6">
        {tab === 'progress' && <ProgressTab projectId={projectId} setup={setup} />}
        {tab === 'details' && <DetailsTab project={project} clients={clients} />}
        {tab === 'commercial' && <CommercialTab project={project} />}
        {tab === 'team' && <TeamTab projectId={projectId} members={members} addable={addable} canManage={canManage} />}
        {tab === 'status' && <StatusTab project={project} />}
      </div>
    </PageContainer>
  );
}
