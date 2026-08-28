import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { redirect } from 'next/navigation';
import { getActiveContext, getAuthUser } from '@/lib/data/org';
import { listClients } from '@/lib/data/clients';
import { listWorkCalendars } from '@/lib/data/calendars';
import { listOrgMembers } from '@/lib/data/org-members';
import { listUnlinkedBoqs } from '@/lib/data/boq';
import { NewProjectForm } from './new-project-form';
import { Card } from '@/components/ui/card';

export default async function NewProjectPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  const orgId = ctx.active.orgId;

  const [clients, calendars, members, boqs] = await Promise.all([
    listClients(orgId),
    listWorkCalendars(orgId),
    listOrgMembers(orgId),
    listUnlinkedBoqs(orgId),
  ]);
  // Only people who can actually run a project may be its PM — owners, admins,
  // and project managers. (Contractors/clients/viewers are blocked from the PM
  // role at the DB anyway; this stops them dangling as options.)
  const activeMembers = members
    .filter((m) => m.status === 'active' && ['owner', 'admin', 'pm'].includes(m.role))
    .map((m) => ({ userId: m.userId, name: m.name }));
  // Anyone active in the org can be picked onto the team at creation.
  const teamOptions = members
    .filter((m) => m.status === 'active')
    .map((m) => ({ userId: m.userId, name: m.name }));
  const defaultCalendarId = calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? '';

  return (
    <PageContainer width="4xl">
      <PageHeader
        backHref="/projects"
        backLabel="Projects"
        title="New project"
        subtitle={
          <>
            In organisation: <span className="font-medium text-brand-600 dark:text-brand-500">{ctx.active.name}</span>
          </>
        }
      />

      <Card className="mt-6">
        <NewProjectForm
          clients={clients}
          calendars={calendars}
          members={activeMembers}
          teamOptions={teamOptions}
          currentUserId={user.id}
          defaultCalendarId={defaultCalendarId}
          boqs={boqs}
        />
      </Card>
    </PageContainer>
  );
}
