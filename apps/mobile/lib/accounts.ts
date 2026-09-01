import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

const ACCOUNTS_KEY = 'dp_accounts';

/** One signed-in account kept on the device so the user can switch without
 *  re-entering credentials. Only the refresh token is stored (same posture as
 *  Supabase's own session persistence in AsyncStorage). */
export interface StoredAccount {
  userId: string;
  email: string | null;
  displayName: string | null;
  refreshToken: string;
  addedAt: string;
}

export async function listAccounts(): Promise<StoredAccount[]> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

async function writeAccounts(list: StoredAccount[]): Promise<void> {
  await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}

async function fetchDisplayName(userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  return (data as { display_name: string | null } | null)?.display_name ?? null;
}

/** Upsert the active session into the registry — called on sign-in and every
 *  token refresh so a switched-away account's refresh token stays current. Only
 *  looks up the display name the first time an account is seen. */
export async function rememberSession(session: Session): Promise<void> {
  if (!session.user || !session.refresh_token) return;
  const list = await listAccounts();
  const existing = list.find((a) => a.userId === session.user.id);
  const displayName = existing?.displayName ?? (await fetchDisplayName(session.user.id));
  const acct: StoredAccount = {
    userId: session.user.id,
    email: session.user.email ?? existing?.email ?? null,
    displayName,
    refreshToken: session.refresh_token,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
  await writeAccounts(existing ? list.map((a) => (a.userId === acct.userId ? acct : a)) : [...list, acct]);
}

/** Restore a stored account as the active session via its refresh token. Throws
 *  (and drops the account) if the token is no longer valid — the caller then
 *  routes to a fresh sign-in. */
export async function switchToAccount(userId: string): Promise<void> {
  const list = await listAccounts();
  const acct = list.find((a) => a.userId === userId);
  if (!acct) throw new Error('Account not found.');
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: acct.refreshToken });
  if (error || !data.session) {
    await removeAccount(userId);
    throw new Error('That account’s session expired — sign in again.');
  }
  await rememberSession(data.session);
}

export async function removeAccount(userId: string): Promise<void> {
  const list = await listAccounts();
  await writeAccounts(list.filter((a) => a.userId !== userId));
}
