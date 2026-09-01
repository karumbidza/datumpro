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

// Serialise all read-modify-write mutations so overlapping token-refresh /
// sign-in events can't clobber each other and silently drop an account.
let chain: Promise<unknown> = Promise.resolve();
async function mutate(update: (list: StoredAccount[]) => StoredAccount[]): Promise<void> {
  const run = chain.then(async () => {
    await writeAccounts(update(await listAccounts()));
  });
  chain = run.catch(() => {});
  return run;
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
  const userId = session.user.id;
  const refreshToken = session.refresh_token;
  const email = session.user.email ?? null;
  // Only fetch the display name the first time we see an account (outside the
  // write lock — the authoritative upsert happens atomically in mutate()).
  const known = (await listAccounts()).find((a) => a.userId === userId);
  const fetchedName = known ? known.displayName : await fetchDisplayName(userId);
  await mutate((list) => {
    const existing = list.find((a) => a.userId === userId);
    const acct: StoredAccount = {
      userId,
      email: email ?? existing?.email ?? null,
      displayName: existing?.displayName ?? fetchedName,
      refreshToken,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    };
    return existing ? list.map((a) => (a.userId === userId ? acct : a)) : [...list, acct];
  });
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
    // A network/retryable failure (offline) is NOT a dead token — keep the
    // account and let the user try again. Only forget it on a genuine rejection.
    const retryable = (error as { name?: string } | null)?.name === 'AuthRetryableFetchError';
    if (!retryable) await removeAccount(userId);
    throw new Error(
      retryable ? 'You appear to be offline — try again.' : 'That account’s session expired — sign in again.',
    );
  }
  await rememberSession(data.session);
}

export async function removeAccount(userId: string): Promise<void> {
  await mutate((list) => list.filter((a) => a.userId !== userId));
}
