/**
 * Permissions — the single source of truth for "who can do what".
 *
 * UI, API route handlers, and (where practical) DB policies all derive from this
 * map so authorization rules live in one place. Database RLS enforces *tenant
 * isolation* (org_id); this layer enforces *capability* within a tenant.
 */

import type { OrgRole } from './roles';

/** Every guarded action in the product. Grouped by domain for readability. */
export const PERMISSIONS = [
  // Tenancy
  'org:manage', // rename, billing, delete
  'member:invite',
  'member:manage', // change roles, deactivate

  // Projects
  'project:create',
  'project:update',
  'project:archive',

  // Field monitoring
  'report:create',
  'report:view',

  // Requests & approvals
  'request:create',
  'request:approve', // decide on an approval step

  // Finance — note the deliberate split (segregation of duties)
  'budget:manage',
  'invoice:create',
  'invoice:send',
  'payment:record',
  'pop:submit', // upload a proof of payment
  'pop:verify', // confirm a POP against a payment
  'variation:approve',
  'finance:view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Base capability granted by an org role.
 *
 * Segregation of duties is encoded here: `finance` can raise and send invoices
 * and record/verify payments, but CANNOT approve variations or approval steps —
 * that authority sits with `pm`/`admin`/`owner`. Conversely a `pm` runs delivery
 * and approvals but cannot move money. Approval *thresholds* (who must sign off
 * above an amount) are layered on top via approval policies, not here.
 */
const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  owner: [...PERMISSIONS], // everything
  admin: [
    'org:manage', 'member:invite', 'member:manage',
    'project:create', 'project:update', 'project:archive',
    'report:create', 'report:view',
    'request:create', 'request:approve',
    'budget:manage', 'invoice:create', 'invoice:send', 'payment:record',
    'pop:submit', 'pop:verify', 'variation:approve', 'finance:view',
  ],
  finance: [
    'report:view', 'finance:view',
    'invoice:create', 'invoice:send', 'payment:record', 'pop:verify',
    'request:create',
  ],
  pm: [
    'project:create', 'project:update',
    'report:create', 'report:view',
    'request:create', 'request:approve', 'variation:approve',
    'finance:view', 'budget:manage',
  ],
  member: [
    'report:create', 'report:view',
    'request:create', 'pop:submit',
  ],
  viewer: ['report:view', 'finance:view'],
};

/** Does this org role grant the given permission? */
export function can(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** All permissions an org role holds (immutable copy). */
export function permissionsFor(role: OrgRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
