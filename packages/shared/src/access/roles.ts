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
