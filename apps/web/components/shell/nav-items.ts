import {
  LayoutDashboard,
  FolderOpen,
  FileText,
  Building,
  Calendar,
  CheckSquare,
  ClipboardList,
  ShieldAlert,
  DollarSign,
  Wallet,
  MessageSquare,
  MessageCircle,
  Settings,
  type IconComponent,
} from '@/components/icons';
import type { SidebarProject } from '@/lib/data/org';
import type { MemberType } from '@datumpro/shared/access';

export interface NavItem {
  name: string;
  href: string;
  icon: IconComponent;
}

/** Active project id from the URL — the single source of truth (no stale cookie).
 *  `/projects/<id>/…` → id; `/projects/new` and `/projects` → none. */
export function activeProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  const id = m?.[1];
  return !id || id === 'new' ? null : id;
}

/** The nav shown for the current context: project-scoped when inside a project,
 *  otherwise the org-level nav. Shared by the desktop sidebar and mobile drawer. */
export function computeNav(
  activeProject: SidebarProject | null,
  canManageMembers: boolean,
  canViewFinance = false,
  showMyPayments = true,
  managedProjectIds: string[] = [],
  memberType: MemberType = 'staff',
): NavItem[] {
  if (activeProject) {
    const id = activeProject.id;
    // Manager of this project = org admin/owner, or its PM. Finance, Requests and
    // Settings (team + setup) are management surfaces — hidden from a contractor
    // whose only role here is doing the assigned work.
    const manages = canManageMembers || managedProjectIds.includes(id);
    const items: NavItem[] = [
      { name: 'Overview', href: `/projects/${id}`, icon: LayoutDashboard },
      { name: 'Tasks', href: `/projects/${id}/tasks`, icon: CheckSquare },
      { name: 'Calendar', href: `/projects/${id}/calendar`, icon: Calendar },
      { name: 'Site Diary', href: `/projects/${id}/diary`, icon: ClipboardList },
      { name: 'Snagging', href: `/projects/${id}/snags`, icon: ShieldAlert },
    ];
    if (manages) {
      items.push({ name: 'Finance', href: `/projects/${id}/finance`, icon: DollarSign });
      items.push({ name: 'BOQ', href: `/projects/${id}/boq`, icon: FileText });
    }
    items.push({ name: 'Chat', href: `/projects/${id}/chat`, icon: MessageSquare });
    if (manages) {
      items.push({ name: 'Project set up', href: `/projects/${id}/settings`, icon: Settings });
    }
    return items;
  }
  return [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'All projects', href: '/projects', icon: FolderOpen },
    ...(memberType === 'contractor'
      ? [{ name: 'Tenders', href: '/boq', icon: FileText }]
      : memberType === 'client' || memberType === 'viewer'
        ? []
        : // The bills-and-tenders library is a management surface (owner/admin, or
          // a PM of any project). Plain staff don't need it.
          canManageMembers || managedProjectIds.length > 0
          ? [{ name: 'BOQ', href: '/boq', icon: FileText }]
          : []),
    // One "Finance" item: managers → the org finance hub; an assignee without
    // finance access → their own statement. Same label, role-appropriate target.
    ...(canViewFinance
      ? [{ name: 'Finance', href: '/finance', icon: DollarSign }]
      : showMyPayments
        ? [{ name: 'Finance', href: '/payments', icon: Wallet }]
        : []),
    ...(canManageMembers
      ? [
          { name: 'Org setup', href: '/org', icon: Building },
          { name: 'Support', href: '/support', icon: MessageCircle },
        ]
      : []),
  ];
}

/** Whether a nav href is the active route for the given pathname. */
export function isNavActive(href: string, pathname: string, activeProject: SidebarProject | null): boolean {
  return (
    href === pathname ||
    (href !== `/projects/${activeProject?.id}` && pathname.startsWith(`${href}/`)) ||
    (href === '/projects' && pathname === '/projects')
  );
}
