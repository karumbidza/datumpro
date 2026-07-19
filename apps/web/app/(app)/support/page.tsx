import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/data/org';
import { SupportChat } from '@/components/support/support-chat';

export const dynamic = 'force-dynamic';

/** Tenant-admin support: chat with the platform team. Available to org owners/
 *  admins; the conversation is per-org. */
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  // Orgs where this user is an admin — the ones they may raise support for.
  const { data: memberships } = await supabase
    .from('org_members')
    .select('org_id, role, organizations(name)')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);

  const orgs = (memberships ?? []).map((m) => ({
    id: m.org_id as string,
    name:
      (Array.isArray(m.organizations) ? m.organizations[0]?.name : (m.organizations as { name?: string })?.name) ??
      'Organization',
  }));

  const configured = Boolean(process.env.PULSE_URL && process.env.ADMIN_ADAPTER_SECRET);
  const active = orgs.find((o) => o.id === org) ?? orgs[0];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Message the DatumPro team. We&apos;ll reply right here.
      </p>

      {!configured ? (
        <p className="mt-8 text-sm text-zinc-500">Support chat isn&apos;t available right now.</p>
      ) : orgs.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">
          Support is available to organization admins. Ask an admin on your team to reach out.
        </p>
      ) : (
        <>
          {orgs.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {orgs.map((o) => (
                <Link
                  key={o.id}
                  href={`/support?org=${o.id}`}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    o.id === active!.id
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'border border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {o.name}
                </Link>
              ))}
            </div>
          )}
          <div className="mt-4">
            <SupportChat orgId={active!.id} />
          </div>
        </>
      )}
    </main>
  );
}
