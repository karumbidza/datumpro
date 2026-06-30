import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { permissionsFor, type OrgRole } from '@datumpro/shared/access';

/** Authenticated dashboard. Demonstrates the end-to-end path: session → active
 *  org membership (RLS-scoped query) → role-aware UI. Real widgets land in the
 *  monitoring/finance slices. */
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  // RLS guarantees this only returns orgs the user actually belongs to.
  const { data: memberships } = await supabase
    .from('org_members')
    .select('role, organizations(id, name)')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const active = memberships?.[0];
  const role = (active?.role ?? 'viewer') as OrgRole;
  const orgName =
    (active?.organizations as { name?: string } | null)?.name ?? 'No organisation yet';

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{orgName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-xs text-zinc-400">
          Signed in as {user.email} · role: <span className="font-medium">{role}</span>
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle>Active projects</CardTitle>
          <CardValue>—</CardValue>
        </Card>
        <Card>
          <CardTitle>Open requests</CardTitle>
          <CardValue>—</CardValue>
        </Card>
        <Card>
          <CardTitle>Outstanding invoices</CardTitle>
          <CardValue>—</CardValue>
        </Card>
      </section>

      <section className="mt-8">
        <Card>
          <CardTitle>Your capabilities</CardTitle>
          <ul className="mt-3 flex flex-wrap gap-2">
            {permissionsFor(role).map((p) => (
              <li
                key={p}
                className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
              >
                {p}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </main>
  );
}
