import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { useSession } from './auth';

/** The "no filter" sentinel — aggregate every org the user belongs to (the
 *  historical mobile behaviour, and the default). */
export const ALL_WORKSPACES = 'all';

export interface OrgOption {
  id: string;
  name: string;
}

interface ActiveOrgState {
  /** An org id, or ALL_WORKSPACES. */
  activeOrgId: string;
  orgs: OrgOption[];
  setActiveOrg: (id: string) => void;
  loading: boolean;
}

const Ctx = createContext<ActiveOrgState>({
  activeOrgId: ALL_WORKSPACES,
  orgs: [],
  setActiveOrg: () => {},
  loading: true,
});

export function useActiveOrg(): ActiveOrgState {
  return useContext(Ctx);
}

/** Turn the context value into a data-layer filter: an org id to scope to, or
 *  null for "all workspaces" (no filter). */
export function orgFilter(activeOrgId: string): string | null {
  return activeOrgId === ALL_WORKSPACES ? null : activeOrgId;
}

function keyFor(userId: string): string {
  return `dp_active_org:${userId}`;
}

/** Tracks the active workspace per signed-in account. Persists the choice so it
 *  survives restarts and account switches, and validates it against the user's
 *  current memberships (falling back to All workspaces). */
export function ActiveOrgProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string>(ALL_WORKSPACES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setOrgs([]);
      setActiveOrgId(ALL_WORKSPACES);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const [{ data: mems }, stored] = await Promise.all([
        supabase.from('org_members').select('org_id, organizations(name)').eq('user_id', userId).eq('status', 'active'),
        AsyncStorage.getItem(keyFor(userId)),
      ]);
      if (!active) return;
      const list: OrgOption[] = (
        (mems ?? []) as { org_id: string; organizations: { name: string | null } | { name: string | null }[] | null }[]
      ).map((m) => {
        const o = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
        return { id: m.org_id, name: o?.name ?? 'Organisation' };
      });
      setOrgs(list);
      const valid = stored === ALL_WORKSPACES || (!!stored && list.some((o) => o.id === stored));
      setActiveOrgId(valid ? (stored as string) : ALL_WORKSPACES);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const setActiveOrg = useCallback(
    (id: string) => {
      setActiveOrgId(id);
      if (userId) void AsyncStorage.setItem(keyFor(userId), id);
    },
    [userId],
  );

  return <Ctx.Provider value={{ activeOrgId, orgs, setActiveOrg, loading }}>{children}</Ctx.Provider>;
}
