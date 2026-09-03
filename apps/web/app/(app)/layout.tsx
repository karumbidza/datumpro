import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import { getActiveContext, getSidebarData } from '@/lib/data/org';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/shell/sidebar';
import { MobileNav } from '@/components/shell/mobile-nav';
import { ToastHost } from '@/components/notifications/toast-host';

/** Authenticated app shell. Renders the persistent sidebar around every page in
 *  this route group. Users with no org membership fall through to the page
 *  (the dashboard shows the create-org onboarding) without a sidebar. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/sign-in');

  // Org-enforced MFA. This is now enforced at the DATA LAYER too (migration
  // 20260101007900): when a require_mfa org's session is still AAL1, the RLS
  // membership helpers return nothing, so `ctx` would show no memberships and we
  // would wrongly fall through to onboarding below. `mfa_required_pending()` is
  // AAL-independent (SECURITY DEFINER), so it still detects the pending factor
  // and sends the user to enrol/verify. /mfa lives outside this route group, so
  // there's no redirect loop. Checked before the no-org branch for that reason.
  {
    const supabase = await createClient();
    const { data: mfaPending } = await supabase.rpc('mfa_required_pending');
    if (mfaPending === true) redirect('/mfa');
  }

  if (!ctx.active) {
    return <div className="min-h-screen">{children}</div>;
  }

  const { projects, myTaskCount, isContractor, managedProjectIds } = await getSidebarData(
    ctx.active.orgId,
    ctx.userId,
  );
  // Nav gating derives from the shared permission map so it always matches the
  // capabilities the DB enforces. PM is a delivery manager: creates projects,
  // views finance — but member management stays owner/admin.
  const role = ctx.active.role;
  const canManageMembers = can(role, 'member:manage');
  const canCreateProject = can(role, 'project:create');
  const canViewFinance = can(role, 'finance:view');
  // Salaried staff carry no per-task money, so they never see the personal
  // Payments statement even when assigned to tasks (which otherwise trips the
  // contractor signal). Money surfaces are for contractors and finance roles.
  const showMyPayments = isContractor && ctx.active.memberType !== 'staff';

  return (
    <div className="flex h-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Skip link (WCAG 2.4.1): lets keyboard users jump past the sidebar nav
          to the page content. Hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <ToastHost userId={ctx.userId} activeOrgId={ctx.active.orgId} orgs={ctx.memberships} />
      <Sidebar
        projects={projects}
        orgs={ctx.memberships}
        activeOrgId={ctx.active.orgId}
        email={ctx.email}
        canManageMembers={canManageMembers}
        canCreateProject={canCreateProject}
        canViewFinance={canViewFinance}
        showMyPayments={showMyPayments}
        managedProjectIds={managedProjectIds}
        myTaskCount={myTaskCount}
        memberType={ctx.active.memberType}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav
          projects={projects}
          orgs={ctx.memberships}
          activeOrgId={ctx.active.orgId}
          email={ctx.email}
          canManageMembers={canManageMembers}
          canCreateProject={canCreateProject}
          canViewFinance={canViewFinance}
          showMyPayments={showMyPayments}
          managedProjectIds={managedProjectIds}
          memberType={ctx.active.memberType}
        />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
