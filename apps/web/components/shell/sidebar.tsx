'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  BarChart3,
  Settings,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  ArrowRight,
  LogOut,
  BrandMark,
  type IconComponent,
} from '@/components/icons';
import type { OrgMembershipSummary, SidebarProject } from '@/lib/data/org';
import { setActiveOrg, signOut } from '@/app/(app)/actions';

interface SidebarProps {
  memberships: OrgMembershipSummary[];
  active: OrgMembershipSummary;
  projects: SidebarProject[];
  myTaskCount: number;
  email: string | null;
}

const NAV: { name: string; href: string; icon: IconComponent }[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderOpen },
];

// Roadmap items — shown to admins/owners as "soon" so the nav reads complete
// without dead links. Wire to real routes as those screens land.
const SOON: { name: string; icon: IconComponent }[] = [
  { name: 'Team', icon: Users },
  { name: 'Reports', icon: BarChart3 },
  { name: 'Settings', icon: Settings },
];

export function Sidebar({ memberships, active, projects, myTaskCount, email }: SidebarProps) {
  const pathname = usePathname();
  const canSeeAdmin = active.role === 'owner' || active.role === 'admin';

  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:flex">
      <OrgSwitcher memberships={memberships} active={active} />

      <nav className="flex-1 overflow-y-auto p-2">
        <div className="space-y-0.5">
          {NAV.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60'
                }`}
              >
                <item.icon size={16} />
                {item.name}
              </Link>
            );
          })}
          {canSeeAdmin &&
            SOON.map((item) => (
              <div
                key={item.name}
                className="flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm text-zinc-400 dark:text-zinc-600"
                title="Coming soon"
              >
                <item.icon size={16} />
                <span>{item.name}</span>
                <span className="ml-auto rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                  soon
                </span>
              </div>
            ))}
        </div>

        <MyTasks count={myTaskCount} />
        <ProjectsTree projects={projects} />
      </nav>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
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

function OrgSwitcher({
  memberships,
  active,
}: {
  memberships: OrgMembershipSummary[];
  active: OrgMembershipSummary;
}) {
  const [open, setOpen] = useState(false);

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
              {active.name}
            </span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {memberships.length} compan{memberships.length !== 1 ? 'ies' : 'y'}
            </span>
          </span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-zinc-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-3 top-full z-50 w-60 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <p className="px-3 pt-3 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Companies
            </p>
            <div className="p-1.5">
              {memberships.map((m) => (
                <form key={m.orgId} action={setActiveOrg}>
                  <input type="hidden" name="orgId" value={m.orgId} />
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <BrandMark size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-800 dark:text-white">
                        {m.name}
                      </span>
                      <span className="block truncate text-xs capitalize text-zinc-500 dark:text-zinc-400">
                        {m.role}
                      </span>
                    </span>
                    {m.orgId === active.orgId && <Check size={16} className="shrink-0 text-brand-500" />}
                  </button>
                </form>
              ))}
            </div>
            <div className="border-t border-zinc-200 p-1.5 dark:border-zinc-700">
              <Link
                href="/orgs/new"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded p-2 text-xs font-medium text-brand-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Plus size={14} /> New company
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MyTasks({ count }: { count: number }) {
  return (
    <div className="mt-6">
      <Link
        href="/dashboard"
        className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      >
        <span className="flex items-center gap-2">
          <CheckSquare size={16} className="text-zinc-500 dark:text-zinc-400" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">My Tasks</span>
        </span>
        <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
          {count}
        </span>
      </Link>
    </div>
  );
}

function ProjectsTree({ projects }: { projects: SidebarProject[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const subItems = (id: string) => [
    { title: 'Tasks', href: `/projects/${id}/tasks` },
    { title: 'Finance', href: `/projects/${id}/finance` },
    { title: 'Requests', href: `/projects/${id}/requests` },
    { title: 'Team', href: `/projects/${id}/team` },
  ];

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Projects</h3>
        <Link
          href="/projects"
          className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white"
          title="All projects"
        >
          <ArrowRight size={12} />
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="px-3 py-1 text-xs text-zinc-400">No projects yet.</p>
      ) : (
        <div className="space-y-0.5">
          {projects.map((project) => (
            <div key={project.id}>
              <button
                onClick={() => toggle(project.id)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                <ChevronRight
                  size={12}
                  className={`shrink-0 text-zinc-400 transition-transform ${
                    expanded.has(project.id) ? 'rotate-90' : ''
                  }`}
                />
                <span className="size-2 shrink-0 rounded-full bg-brand-500" />
                <span className="truncate">{project.name}</span>
              </button>

              {expanded.has(project.id) && (
                <div className="ml-5 mt-0.5 space-y-0.5">
                  {subItems(project.id).map((sub) => (
                    <Link
                      key={sub.title}
                      href={sub.href}
                      className="block rounded-md px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                    >
                      {sub.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
