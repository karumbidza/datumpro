import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getActiveContext, getSidebarData } from '@/lib/data/org';
import { Sidebar } from '@/components/shell/sidebar';
import { MobileNav } from '@/components/shell/mobile-nav';

/** Authenticated app shell. Renders the persistent sidebar around every page in
 *  this route group. Users with no org membership fall through to the page
 *  (the dashboard shows the create-org onboarding) without a sidebar. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');

  if (!ctx.active) {
    return <div className="min-h-screen">{children}</div>;
  }

  const { projects, myTaskCount } = await getSidebarData(ctx.active.orgId, ctx.userId);
  const canCreate = ctx.active.role === 'owner' || ctx.active.role === 'admin';

  return (
    <div className="flex h-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar
        projects={projects}
        orgs={ctx.memberships}
        activeOrgId={ctx.active.orgId}
        email={ctx.email}
        canCreate={canCreate}
        myTaskCount={myTaskCount}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav
          projects={projects}
          orgs={ctx.memberships}
          activeOrgId={ctx.active.orgId}
          email={ctx.email}
          canCreate={canCreate}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
