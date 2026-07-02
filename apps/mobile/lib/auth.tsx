import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

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
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>;
}
