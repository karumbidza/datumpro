import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { listClients } from '@/lib/data/clients';
import { listWorkCalendars } from '@/lib/data/calendars';
import { listOrgMembers } from '@/lib/data/org-members';
import { NewProjectForm } from './new-project-form';
import { Card } from '@/components/ui/card';

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/orgs/new');
  const orgId = ctx.active.orgId;

  const [clients, calendars, members] = await Promise.all([
    listClients(orgId),
    listWorkCalendars(orgId),
    listOrgMembers(orgId),
  ]);
  // Only people who can actually run a project may be its PM — owners, admins,
  // and project managers. (Contractors/clients/viewers are blocked from the PM
  // role at the DB anyway; this stops them dangling as options.)
  const activeMembers = members
    .filter((m) => m.status === 'active' && ['owner', 'admin', 'pm'].includes(m.role))
    .map((m) => ({ userId: m.userId, name: m.name }));
  const defaultCalendarId = calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? '';

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href="/projects" className="text-xs text-zinc-500 hover:underline">
        ← Projects
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New project</h1>

      <Card className="mt-6">
        <NewProjectForm
          clients={clients}
          calendars={calendars}
          members={activeMembers}
          currentUserId={user.id}
          defaultCalendarId={defaultCalendarId}
        />
      </Card>
    </main>
  );
}
