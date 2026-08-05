import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import { getActiveContext, getSidebarData } from '@/lib/data/org';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/shell/sidebar';
import { MobileNav } from '@/components/shell/mobile-nav';

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

  return (
    <div className="flex h-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar
        projects={projects}
        orgs={ctx.memberships}
        activeOrgId={ctx.active.orgId}
        email={ctx.email}
        canManageMembers={canManageMembers}
        canCreateProject={canCreateProject}
        canViewFinance={canViewFinance}
        showMyPayments={isContractor}
        managedProjectIds={managedProjectIds}
        myTaskCount={myTaskCount}
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
          showMyPayments={isContractor}
          managedProjectIds={managedProjectIds}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
