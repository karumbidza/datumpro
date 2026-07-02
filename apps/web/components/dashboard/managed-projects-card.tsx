import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { ChevronRight } from '@/components/icons';
import type { ManagedProject } from '@/lib/data/home';

/** Projects the viewer runs, each with a completion bar. The delivery cockpit's
 *  anchor — where a PM jumps into the project they need to move. */
export function ManagedProjectsCard({ projects }: { projects: ManagedProject[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>My projects</CardTitle>
        <span className="text-xs text-zinc-500 tabular-nums">{projects.length}</span>
      </div>
      {projects.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          You don&apos;t manage any projects yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {projects.map((p) => {
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="group flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium group-hover:underline">{p.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
                        {p.done}/{p.total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-zinc-300 group-hover:text-zinc-500" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
