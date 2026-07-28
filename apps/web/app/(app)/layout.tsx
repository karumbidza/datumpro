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

  if (!ctx.active) {
    return <div className="min-h-screen">{children}</div>;
  }

  // Org-enforced MFA: if this org requires 2FA and the session hasn't reached
  // AAL2, send the user to enrol/verify. /mfa lives outside this route group, so
  // there's no redirect loop.
  {
    const supabase = await createClient();
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('require_mfa')
      .eq('id', ctx.active.orgId)
      .single();
    if ((orgRow as { require_mfa?: boolean } | null)?.require_mfa) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.currentLevel !== 'aal2') redirect('/mfa');
    }
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
