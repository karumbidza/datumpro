import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { getProjectSetup, SETUP_ITEMS } from '@/lib/data/project-setup';
import { Button } from '@/components/ui/button';
import { Check } from '@/components/icons';

export default async function ProjectSetupPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  const { status, done, total, pct } = await getProjectSetup(projectId);
  const outstanding = total - done;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Project setup</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {pct}% complete
        {outstanding > 0 ? ` · ${outstanding} item${outstanding === 1 ? '' : 's'} outstanding` : ' · all done 🎉'}
      </p>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-2 rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ul className="mt-6 flex flex-col gap-2">
        {SETUP_ITEMS.map((item) => {
          const complete = status[item.key];
          const href = item.href ? item.href(projectId) : null;
          const inner = (
            <div
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                complete
                  ? 'border-zinc-200 dark:border-zinc-800'
                  : 'border-zinc-200 dark:border-zinc-800'
              } ${href && !complete ? 'hover:border-zinc-300 dark:hover:border-zinc-700' : ''}`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  complete
                    ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
                    : 'border border-zinc-300 text-transparent dark:border-zinc-600'
                }`}
              >
                {complete && <Check size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    complete ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'
                  }`}
                >
                  {item.label}
                </p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{item.hint}</p>
              </div>
              {!complete &&
                (href ? (
                  <span className="text-xs font-medium text-brand-600 dark:text-brand-500">Set up →</span>
                ) : (
                  <span className="text-xs text-zinc-300 dark:text-zinc-600">Coming soon</span>
                ))}
            </div>
          );
          return (
            <li key={item.key}>
              {href && !complete ? (
                <Link href={href} className="block">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-6">
        <Link href={`/projects/${projectId}`}>
          <Button variant="secondary">Continue to project →</Button>
        </Link>
      </div>
    </main>
  );
}
