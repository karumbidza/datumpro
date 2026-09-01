import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { rememberSession } from './accounts';

interface SessionState {
  session: Session | null;
  loading: boolean;
}

const SessionContext = createContext<SessionState>({ session: null, loading: true });

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/** Tracks the Supabase auth session and keeps it live across token refreshes and
 *  sign-in/out. Wrap the app root in this. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      if (data.session) void rememberSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Keep the multi-account registry's refresh token current for the active
      // account on sign-in and every silent refresh.
      if (next && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) void rememberSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>;
}
