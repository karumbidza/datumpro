import {
  LayoutDashboard,
  FolderOpen,
  Users,
  CheckSquare,
  DollarSign,
  Wallet,
  FileText,
  MessageSquare,
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
  canCreate: boolean,
  canViewFinance = false,
): NavItem[] {
  if (activeProject) {
    return [
      { name: 'Overview', href: `/projects/${activeProject.id}`, icon: LayoutDashboard },
      { name: 'Tasks', href: `/projects/${activeProject.id}/tasks`, icon: CheckSquare },
      { name: 'Finance', href: `/projects/${activeProject.id}/finance`, icon: DollarSign },
      { name: 'Requests', href: `/projects/${activeProject.id}/requests`, icon: FileText },
      { name: 'Chat', href: `/projects/${activeProject.id}/chat`, icon: MessageSquare },
      { name: 'Team', href: `/projects/${activeProject.id}/team`, icon: Users },
    ];
  }
  return [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'All projects', href: '/projects', icon: FolderOpen },
    { name: 'My payments', href: '/payments', icon: Wallet },
    ...(canViewFinance ? [{ name: 'Finance', href: '/finance', icon: DollarSign }] : []),
    ...(canCreate ? [{ name: 'Members', href: '/org/members', icon: Users }] : []),
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
