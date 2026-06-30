import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listProjects } from '@/lib/data/projects';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatUsd } from '@datumpro/shared/domain';

const STATUS_TONE = {
  active: 'green',
  planning: 'blue',
  on_hold: 'amber',
  completed: 'neutral',
  archived: 'neutral',
} as const;

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const projects = await listProjects();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>

      {projects.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          No projects yet.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`}>
                <Card className="transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{p.name}</h2>
                      {p.client_name && (
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {p.client_name}
                        </p>
                      )}
                    </div>
                    <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                    Contract {formatUsd(p.contract_value_cents)}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
