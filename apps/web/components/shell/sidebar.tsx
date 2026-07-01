'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  CheckSquare,
  DollarSign,
  FileText,
  ChevronDown,
  Check,
  Plus,
  LogOut,
  BrandMark,
  type IconComponent,
} from '@/components/icons';
import type { SidebarProject } from '@/lib/data/org';
import { signOut } from '@/app/(app)/actions';

interface SidebarProps {
  projects: SidebarProject[];
  companyName: string;
  email: string | null;
  canCreate: boolean;
  myTaskCount: number;
}

interface NavItem {
  name: string;
  href: string;
  icon: IconComponent;
}

/** Parse the active project id from the URL (source of truth — no cookie to go
 *  stale). `/projects/<id>/…` → id; `/projects/new` and `/projects` → none. */
function activeProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  const id = m?.[1];
  return !id || id === 'new' ? null : id;
}

export function Sidebar({ projects, companyName, email, canCreate, myTaskCount }: SidebarProps) {
  const pathname = usePathname();
  const activeId = activeProjectId(pathname);
  const activeProject = projects.find((p) => p.id === activeId) ?? null;

  const nav: NavItem[] = activeProject
    ? [
        { name: 'Overview', href: `/projects/${activeProject.id}`, icon: LayoutDashboard },
        { name: 'Tasks', href: `/projects/${activeProject.id}/tasks`, icon: CheckSquare },
        { name: 'Finance', href: `/projects/${activeProject.id}/finance`, icon: DollarSign },
        { name: 'Requests', href: `/projects/${activeProject.id}/requests`, icon: FileText },
        { name: 'Team', href: `/projects/${activeProject.id}/team`, icon: Users },
      ]
    : [
        { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { name: 'All projects', href: '/projects', icon: FolderOpen },
      ];

  const isActive = (href: string) =>
    href === pathname ||
    // Overview is exact; deeper items match their subtree.
    (href !== `/projects/${activeProject?.id}` && pathname.startsWith(`${href}/`)) ||
    (href === '/projects' && pathname === '/projects');

  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:flex">
      <ProjectSwitcher
        projects={projects}
        activeProject={activeProject}
        canCreate={canCreate}
      />

      <nav className="flex-1 overflow-y-auto p-2">
        {activeProject && (
          <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            {activeProject.name}
          </p>
        )}
        <div className="space-y-0.5">
          {nav.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive(item.href)
                  ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60'
              }`}
            >
              <item.icon size={16} />
              {item.name}
            </Link>
          ))}
        </div>

        {!activeProject && (
          <Link
            href="/dashboard"
            className="mt-6 flex items-center justify-between rounded-md px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
          >
            <span className="flex items-center gap-2">
              <CheckSquare size={16} className="text-zinc-500 dark:text-zinc-400" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">My Tasks</span>
            </span>
            <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
              {myTaskCount}
            </span>
          </Link>
        )}
      </nav>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <p className="truncate text-[11px] font-medium text-zinc-600 dark:text-zinc-300">{companyName}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{email}</p>
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <LogOut size={14} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function ProjectSwitcher({
  projects,
  activeProject,
  canCreate,
}: {
  projects: SidebarProject[];
  activeProject: SidebarProject | null;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = activeProject?.name ?? 'All projects';

  return (
    <div className="relative flex h-[70px] items-center border-b border-zinc-200 px-3 dark:border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <span className="flex min-w-0 items-center gap-3">
          <BrandMark size={32} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-white">
              {label}
            </span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </span>
          </span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-zinc-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-3 top-full z-50 max-h-96 w-60 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <div className="p-1.5">
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <FolderOpen size={16} className="text-zinc-500" />
                <span className="flex-1 text-sm font-medium text-zinc-800 dark:text-white">All projects</span>
                {!activeProject && <Check size={16} className="text-brand-500" />}
              </Link>
            </div>

            {projects.length > 0 && (
              <>
                <p className="px-3 pt-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                  Projects
                </p>
                <div className="p-1.5">
                  {projects.map((p) => (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="size-2 shrink-0 rounded-full bg-brand-500" />
                      <span className="flex-1 truncate text-sm text-zinc-800 dark:text-white">{p.name}</span>
                      {activeProject?.id === p.id && <Check size={16} className="shrink-0 text-brand-500" />}
                    </Link>
                  ))}
                </div>
              </>
            )}

            {canCreate && (
              <div className="border-t border-zinc-200 p-1.5 dark:border-zinc-700">
                <Link
                  href="/projects/new"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded p-2 text-sm font-medium text-brand-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Plus size={14} /> New project
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
