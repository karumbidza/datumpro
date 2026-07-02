'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Check, LogOut, Users, BrandMark } from '@/components/icons';
import type { SidebarProject, OrgMembershipSummary } from '@/lib/data/org';
import { signOut, setActiveOrg } from '@/app/(app)/actions';
import { activeProjectId, computeNav, isNavActive } from '@/components/shell/nav-items';

interface Props {
  projects: SidebarProject[];
  orgs: OrgMembershipSummary[];
  activeOrgId: string;
  email: string | null;
  canCreate: boolean;
  canViewFinance: boolean;
}

/** Mobile-only top bar + slide-over drawer. The desktop sidebar is hidden below
 *  `md`, so this is the sole navigation on phones. */
export function MobileNav({ projects, orgs, activeOrgId, email, canCreate, canViewFinance }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId(pathname)) ?? null;
  const nav = computeNav(activeProject, canCreate, canViewFinance);
  const activeOrgName = orgs.find((o) => o.orgId === activeOrgId)?.name ?? 'DatumPro';

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="md:hidden">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Menu size={22} />
        </button>
        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
          {activeProject?.name ?? activeOrgName}
        </span>
      </header>

      {open && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85%] flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <span className="flex items-center gap-2">
                <BrandMark size={26} />
                <span className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
                  {activeOrgName}
                </span>
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-zinc-500">
                <X size={20} />
              </button>
            </div>

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
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                      isNavActive(item.href, pathname, activeProject)
                        ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                        : 'text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    <item.icon size={16} />
                    {item.name}
                  </Link>
                ))}
              </div>

              {projects.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-4 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                    Projects
                  </p>
                  <div className="space-y-0.5">
                    {projects.map((p) => (
                      <Link
                        key={p.id}
                        href={`/projects/${p.id}`}
                        className={`block truncate rounded-md px-3 py-2 text-sm ${
                          activeProject?.id === p.id
                            ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                            : 'text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {p.name}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </nav>

            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              {orgs.length > 1 && (
                <div className="mb-2">
                  <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-zinc-400">Organisation</p>
                  {orgs.map((o) => (
                    <form key={o.orgId} action={setActiveOrg}>
                      <input type="hidden" name="orgId" value={o.orgId} />
                      <button
                        type="submit"
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <span className="truncate">{o.name}</span>
                        {o.orgId === activeOrgId && <Check size={14} className="text-brand-600" />}
                      </button>
                    </form>
                  ))}
                </div>
              )}
              <Link
                href="/account"
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Users size={14} /> Account
              </Link>
              <div className="mt-1 flex items-center justify-between gap-2 px-2">
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{email}</span>
                <form action={signOut}>
                  <button type="submit" className="flex items-center gap-1 rounded p-1 text-zinc-500" title="Sign out">
                    <LogOut size={16} />
                  </button>
                </form>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
