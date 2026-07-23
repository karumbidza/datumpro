import {
  LayoutDashboard,
  FolderOpen,
  Building,
  CheckSquare,
  DollarSign,
  Wallet,
  MessageSquare,
  MessageCircle,
  Settings,
  type IconComponent,
} from '@/components/icons';
import type { SidebarProject } from '@/lib/data/org';

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
    ];
    if (manages) {
      items.push({ name: 'Finance', href: `/projects/${id}/finance`, icon: DollarSign });
    }
    items.push({ name: 'Chat', href: `/projects/${id}/chat`, icon: MessageSquare });
    if (manages) {
      items.push({ name: 'Settings', href: `/projects/${id}/settings`, icon: Settings });
    }
    return items;
  }
  return [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'All projects', href: '/projects', icon: FolderOpen },
    ...(showMyPayments
      ? [{ name: 'Payments & documents', href: '/payments', icon: Wallet }]
      : []),
    ...(canViewFinance ? [{ name: 'Finance', href: '/finance', icon: DollarSign }] : []),
    ...(canManageMembers
      ? [
          { name: 'Organization', href: '/org', icon: Building },
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
