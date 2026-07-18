import { createClient } from '@/lib/supabase/server';

export interface SetupStatusRow {
  commercial_done: boolean;
  payment_terms_done: boolean;
  team_done: boolean;
  client_access_done: boolean;
  permit_done: boolean;
  insurance_done: boolean;
  wbs_done: boolean;
  location_done: boolean;
}

export type SetupItemKey = keyof SetupStatusRow;

export interface SetupItem {
  key: SetupItemKey;
  label: string;
  hint: string;
  /** Deep-link to the section that satisfies this item, or null when that screen
   *  doesn't exist yet (rendered as outstanding + disabled, never a fake page). */
  href: ((projectId: string) => string) | null;
}

export const SETUP_ITEMS: SetupItem[] = [
  { key: 'commercial_done', label: 'Commercial terms', hint: 'Contract value & currency', href: null },
  { key: 'payment_terms_done', label: 'Payment terms', hint: 'Retention & payment days', href: null },
  { key: 'team_done', label: 'Team', hint: 'Add your internal team', href: (id) => `/projects/${id}/team` },
  { key: 'client_access_done', label: 'Client access', hint: 'Give the client access', href: (id) => `/projects/${id}/team` },
  { key: 'permit_done', label: 'Building permit', hint: 'Coming soon', href: null },
  { key: 'insurance_done', label: 'Insurance', hint: 'Coming soon', href: null },
  { key: 'wbs_done', label: 'Work breakdown (WBS)', hint: 'Break the project into tasks', href: (id) => `/projects/${id}/tasks` },
  { key: 'location_done', label: 'Site location', hint: 'Coming soon', href: null },
];

const EMPTY: SetupStatusRow = {
  commercial_done: false,
  payment_terms_done: false,
  team_done: false,
  client_access_done: false,
  permit_done: false,
  insurance_done: false,
  wbs_done: false,
  location_done: false,
};

/** Reads project_setup_status (RLS-scoped) and derives completion. */
export async function getProjectSetup(
  projectId: string,
): Promise<{ status: SetupStatusRow; done: number; total: number; pct: number }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('project_setup_status')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();
  const status = { ...EMPTY, ...(data as Partial<SetupStatusRow> | null) };
  const total = SETUP_ITEMS.length;
  const done = SETUP_ITEMS.filter((i) => status[i.key]).length;
  return { status, done, total, pct: Math.round((done / total) * 100) };
}
