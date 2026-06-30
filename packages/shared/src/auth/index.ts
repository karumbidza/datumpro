/**
 * Auth provider interface.
 *
 * We start on Supabase Auth, but the rest of the app depends ONLY on this
 * interface — never on Supabase's auth client directly. That keeps enterprise SSO
 * (WorkOS / Clerk / SAML) a drop-in replacement later instead of a rewrite.
 */

import type { OrgRole } from '../access/roles';

/** The authenticated principal as the app understands it (provider-agnostic). */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** A user's membership of the *active* organisation, resolved from the session. */
export interface ActiveMembership {
  orgId: string;
  role: OrgRole;
}

export interface SessionContext {
  user: AuthUser;
  membership: ActiveMembership | null;
}

export interface AuthProvider {
  /** Current session, or null if unauthenticated. */
  getSession(): Promise<SessionContext | null>;
  signInWithEmailOtp(email: string): Promise<void>;
  signOut(): Promise<void>;
}
