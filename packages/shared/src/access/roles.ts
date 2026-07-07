/**
 * Roles — two layers of authority.
 *
 * Org roles govern tenant-wide capability (who can manage members, money, etc).
 * Project roles govern access within a single project. A user's effective ability
 * is the union of the two, gated by {@link ../permissions}.
 */

export const ORG_ROLES = ['owner', 'admin', 'finance', 'pm', 'member', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PROJECT_ROLES = ['pm', 'contractor', 'contributor', 'client', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/**
 * Member TYPE — the single choice made at invitation. A legible label that
 * (a) sets the person's org role and (b) constrains which project roles they may
 * ever hold, so "what someone is" is pinned at invite time instead of being
 * re-shaped later at project assignment. `owner` is never invited (it comes from
 * creating the org), so INVITABLE_MEMBER_TYPES excludes it.
 */
export const MEMBER_TYPES = ['owner', 'admin', 'pm', 'finance', 'staff', 'contractor', 'client', 'viewer'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export const INVITABLE_MEMBER_TYPES = MEMBER_TYPES.filter((t) => t !== 'owner') as readonly MemberType[];

export const MEMBER_TYPE_META: Record<MemberType, { label: string; hint: string }> = {
  owner: { label: 'Owner', hint: 'Full control of the organisation.' },
  admin: { label: 'Admin', hint: 'Manages members, projects, and money.' },
  pm: { label: 'Project Manager', hint: 'Runs delivery & approvals across projects.' },
  finance: { label: 'Finance', hint: 'Invoicing and payments (no approvals).' },
  staff: { label: 'Staff', hint: 'Internal team member — fieldwork & reports.' },
  contractor: { label: 'Contractor', hint: 'External — quotes and works on assigned tasks.' },
  client: { label: 'Client', hint: 'External — read-only view of their project.' },
  viewer: { label: 'Viewer', hint: 'Read-only across the organisation.' },
};

/** The org role a member type grants (capabilities flow through org role). */
export function memberTypeToOrgRole(type: MemberType): OrgRole {
  switch (type) {
    case 'owner': return 'owner';
    case 'admin': return 'admin';
    case 'pm': return 'pm';
    case 'finance': return 'finance';
    case 'staff': return 'member';
    case 'contractor': return 'member';
    case 'client': return 'viewer';
    case 'viewer': return 'viewer';
  }
}

/**
 * Which project roles a member of this type may be assigned. Mirrors the DB
 * trigger `enforce_project_role_for_type` so the UI only offers valid roles.
 * Granting 'pm' additionally requires the *assigner* to be an org admin/PM
 * (enforced by RLS) — the type only says whether 'pm' is *eligible* at all.
 */
export function projectRolesForType(type: MemberType): readonly ProjectRole[] {
  switch (type) {
    case 'owner':
    case 'admin':
    case 'pm':
    case 'staff':
      return ['pm', 'contractor', 'contributor', 'viewer'];
    case 'contractor':
      return ['contractor', 'contributor'];
    case 'client':
      return ['client', 'viewer'];
    case 'finance':
    case 'viewer':
      return ['viewer', 'client'];
  }
}

export function isMemberType(value: unknown): value is MemberType {
  return typeof value === 'string' && (MEMBER_TYPES as readonly string[]).includes(value);
}

/**
 * Rank for "at least this role" comparisons. Higher = more authority.
 * Note: `finance` is intentionally NOT above `pm` — they are different axes of
 * authority (money vs delivery), so capability is resolved per-permission, not by
 * a single ladder. Ranking exists only for coarse checks (e.g. admin screens).
 */
const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner: 50,
  admin: 40,
  finance: 30,
  pm: 30,
  member: 20,
  viewer: 10,
};

export function orgRoleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[min];
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (PROJECT_ROLES as readonly string[]).includes(value);
}
