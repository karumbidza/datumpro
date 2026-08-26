import Link from 'next/link';
import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { listNotifications } from '@/lib/data/notifications';
import { LiveRefresh } from '@/components/live-refresh';
import { EmptyState } from '@/components/ui/empty-state';
import { Bell } from '@/components/icons';
import { MarkReadOnMount } from './mark-read-on-mount';

function relTime(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default async function NotificationsPage() {
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const items = await listNotifications(50);

  return (
    <PageContainer width="3xl">
      <LiveRefresh subscriptions={[{ table: 'notifications', filter: `user_id=eq.${user.id}` }]} />
      <MarkReadOnMount />
      <PageHeader
        title="Notifications"
        subtitle="Task assignments, acceptances, and updates that need your attention."
      />

      {items.length === 0 ? (
        <EmptyState className="mt-4" icon={Bell} title="You're all caught up" hint="New task assignments and updates will land here." />
      ) : (
        <ul className="mt-6 space-y-2">
          {items.map((n) => {
            const inner = (
              <div
                className={`rounded-lg border px-4 py-3 ${
                  n.readAt
                    ? 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'
                    : 'border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{n.title}</p>
                  <span className="flex-shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{relTime(n.createdAt)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{n.body}</p>}
              </div>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className="block hover:opacity-90">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
