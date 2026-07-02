'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Users,
  FolderOpen,
  CheckSquare,
  ChevronDown,
  Check,
  Plus,
  LogOut,
  BrandMark,
} from '@/components/icons';
import type { SidebarProject, OrgMembershipSummary } from '@/lib/data/org';
import { signOut, setActiveOrg } from '@/app/(app)/actions';
import { activeProjectId, computeNav, isNavActive } from '@/components/shell/nav-items';

interface SidebarProps {
  projects: SidebarProject[];
  orgs: OrgMembershipSummary[];
  activeOrgId: string;
  email: string | null;
  canManageMembers: boolean;
  canCreateProject: boolean;
  canViewFinance: boolean;
  myTaskCount: number;
}

export function Sidebar({ projects, orgs, activeOrgId, email, canManageMembers, canCreateProject, canViewFinance, myTaskCount }: SidebarProps) {
  const pathname = usePathname();
  const activeId = activeProjectId(pathname);
  const activeProject = projects.find((p) => p.id === activeId) ?? null;

  const nav = computeNav(activeProject, canManageMembers, canViewFinance);
  const isActive = (href: string) => isNavActive(href, pathname, activeProject);

  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:flex">
      <ProjectSwitcher
        projects={projects}
        activeProject={activeProject}
        canCreate={canCreateProject}
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
        <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
        <div className="mt-1 flex items-center justify-between gap-2">
          <Link
            href="/account"
            title="Account settings"
            className="min-w-0 flex-1 truncate text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
          >
            {email}
          </Link>
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

/** Company name that expands into an org switcher. Each org is its own tiny form
 *  posting to setActiveOrg (a server action that flips the cookie + redirects). */
function OrgSwitcher({ orgs, activeOrgId }: { orgs: OrgMembershipSummary[]; activeOrgId: string }) {
  const [open, setOpen] = useState(false);
  const active = orgs.find((o) => o.orgId === activeOrgId);
  const activeName = active?.name ?? 'Organisation';

  return (
    <div className="relative">
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
              Organisations
            </p>
            {orgs.map((o) => (
              <form key={o.orgId} action={setActiveOrg}>
                <input type="hidden" name="orgId" value={o.orgId} />
                <button
                  type="submit"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">{o.name}</span>
                  {o.orgId === activeOrgId && <Check size={14} className="shrink-0 text-brand-600" />}
                </button>
              </form>
            ))}
            <Link
              href="/orgs/new"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Plus size={14} /> New organisation
            </Link>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title="Switch organisation"
      >
        <span className="truncate text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
          {activeName}
        </span>
        <ChevronDown size={12} className="shrink-0 text-zinc-400" />
      </button>
    </div>
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
