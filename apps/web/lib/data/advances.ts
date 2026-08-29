import 'server-only';
import { createClient } from '@/lib/supabase/server';

export interface AdvanceRow {
  id: string;
  contractorId: string;
  contractorName: string | null;
  amountCents: number;
  reference: string | null;
  note: string | null;
  status: 'active' | 'cancelled';
  createdAt: string;
}

export interface ContractorAdvanceSummary {
  contractorId: string;
  contractorName: string | null;
  issuedCents: number; // active advances issued
  recoupedCents: number; // offset against earned work so far = min(issued, entitlement)
  outstandingCents: number; // still to recoup = max(0, issued − entitlement)
}

export interface ProjectAdvances {
  advances: AdvanceRow[];
  summaries: ContractorAdvanceSummary[];
  members: { userId: string; name: string | null }[]; // contractors an advance can be issued to
}

/** Manager view: advances on a project — the ledger, each contractor's recoupment
 *  position, and the contractors an advance may be issued to. RLS scopes reads. */
export async function getProjectAdvances(projectId: string): Promise<ProjectAdvances> {
  const supabase = await createClient();

  const [{ data: advRows }, { data: memberRows }] = await Promise.all([
    supabase
      .from('contractor_advances')
      .select('id, contractor_id, amount_cents, reference, note, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    supabase
      .from('project_members')
      .select('user_id, role, status')
      .eq('project_id', projectId)
      .in('role', ['contractor', 'contributor']),
  ]);

  const advances = (advRows ?? []) as {
    id: string;
    contractor_id: string;
    amount_cents: number;
    reference: string | null;
    note: string | null;
    status: 'active' | 'cancelled';
    created_at: string;
  }[];
  const members = ((memberRows ?? []) as { user_id: string; role: string; status: string | null }[]).filter(
    (m) => (m.status ?? 'active') === 'active',
  );

  // Names for everyone who appears (advance recipients + eligible members).
  const ids = [...new Set([...advances.map((a) => a.contractor_id), ...members.map((m) => m.user_id)])];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name, email').in('id', ids);
    for (const p of (profs ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
      names.set(p.id, p.display_name || p.email || 'Contractor');
    }
  }

  // Recoupment per contractor with an active advance.
  const issuedByContractor = new Map<string, number>();
  for (const a of advances) {
    if (a.status !== 'active') continue;
    issuedByContractor.set(a.contractor_id, (issuedByContractor.get(a.contractor_id) ?? 0) + a.amount_cents);
  }
  const summaries: ContractorAdvanceSummary[] = await Promise.all(
    [...issuedByContractor.entries()].map(async ([cid, issued]) => {
      const { data: ent } = await supabase.rpc('project_contractor_entitlement_cents', {
        p_project_id: projectId,
        p_contractor: cid,
      });
      const entitlement = (ent as number | null) ?? 0;
      const recouped = Math.min(issued, entitlement);
      return {
        contractorId: cid,
        contractorName: names.get(cid) ?? null,
        issuedCents: issued,
        recoupedCents: recouped,
        outstandingCents: Math.max(0, issued - entitlement),
      };
    }),
  );
  summaries.sort((a, b) => b.outstandingCents - a.outstandingCents);

  return {
    advances: advances.map((a) => ({
      id: a.id,
      contractorId: a.contractor_id,
      contractorName: names.get(a.contractor_id) ?? null,
      amountCents: a.amount_cents,
      reference: a.reference,
      note: a.note,
      status: a.status,
      createdAt: a.created_at,
    })),
    summaries,
    members: members.map((m) => ({ userId: m.user_id, name: names.get(m.user_id) ?? null })),
  };
}

export interface MyAdvanceRow {
  projectId: string;
  projectName: string;
  issuedCents: number;
  recoupedCents: number;
  outstandingCents: number;
}

/** Contractor view: advances the signed-in user holds, per project — issued,
 *  recouped against earned work, and still outstanding. */
export async function listMyAdvances(userId: string): Promise<MyAdvanceRow[]> {
  const supabase = await createClient();
  const { data: advRows } = await supabase
    .from('contractor_advances')
    .select('project_id, amount_cents, projects(name)')
    .eq('contractor_id', userId)
    .eq('status', 'active');

  type Row = {
    project_id: string;
    amount_cents: number;
    projects: { name: string | null } | { name: string | null }[] | null;
  };
  const issuedByProject = new Map<string, { name: string; issued: number }>();
  for (const r of (advRows ?? []) as Row[]) {
    const pj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    const cur = issuedByProject.get(r.project_id) ?? { name: pj?.name ?? 'Project', issued: 0 };
    cur.issued += r.amount_cents;
    issuedByProject.set(r.project_id, cur);
  }
  if (issuedByProject.size === 0) return [];

  return Promise.all(
    [...issuedByProject.entries()].map(async ([pid, v]) => {
      const { data: ent } = await supabase.rpc('project_contractor_entitlement_cents', {
        p_project_id: pid,
        p_contractor: userId,
      });
      const entitlement = (ent as number | null) ?? 0;
      return {
        projectId: pid,
        projectName: v.name,
        issuedCents: v.issued,
        recoupedCents: Math.min(v.issued, entitlement),
        outstandingCents: Math.max(0, v.issued - entitlement),
      };
    }),
  );
}
