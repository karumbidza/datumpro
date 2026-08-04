import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveContext } from '@/lib/data/org';
import { can } from '@datumpro/shared/access';
import { PageContainer } from '@/components/shell/page-container';
import { Card } from '@/components/ui/card';

/** "member.role_changed" → "member · role changed". Best-effort humaniser. */
function humanize(entityType: string, action: string): string {
  const verb = action.split('.').pop()?.replace(/_/g, ' ') ?? action;
  return `${entityType.replace(/_/g, ' ')} · ${verb}`;
}

export default async function AuditPage() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');
  if (!ctx.active || !can(ctx.active.role, 'org:manage')) redirect('/org');

  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, actor_id, entity_type, entity_id, action, created_at')
    .eq('org_id', ctx.active.orgId)
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (data ?? []) as {
    id: string;
    actor_id: string | null;
    entity_type: string;
    entity_id: string | null;
    action: string;
    created_at: string;
  }[];

  // Resolve actor display names in one round-trip (RLS lets admins read co-member profiles).
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const { data: profiles } = actorIds.length
    ? await supabase.from('profiles').select('id, display_name, email').in('id', actorIds)
    : { data: [] as { id: string; display_name: string | null; email: string | null }[] };
  const nameOf = new Map(
    ((profiles ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.display_name || p.email || 'Unknown',
    ]),
  );

  return (
    <PageContainer width="3xl">
      <Link href="/org" className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
        ← Organisation
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Who did what — the last 200 consequential actions in this organisation. Read-only and tamper-evident.
      </p>

      <Card className="mt-6 overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">No activity recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-400 dark:text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="whitespace-nowrap px-4 py-2 text-zinc-500 dark:text-zinc-400">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{r.actor_id ? nameOf.get(r.actor_id) ?? 'Unknown' : 'System'}</td>
                  <td className="px-4 py-2">{humanize(r.entity_type, r.action)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageContainer>
  );
}
