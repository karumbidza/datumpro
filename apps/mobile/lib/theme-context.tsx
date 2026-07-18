import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors, type Colors, type Scheme } from './theme';

const STORAGE_KEY = 'dp_theme_scheme';

type ThemeValue = {
  colors: Colors;
  scheme: Scheme;
  /** true once the persisted preference has loaded (avoids a first-paint flash). */
  ready: boolean;
  toggle: () => void;
  setScheme: (s: Scheme) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

/** Seeds from the OS colour scheme on first launch, then honours the user's saved
 *  choice. The choice persists to AsyncStorage and is exposed via toggle(). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<Scheme>(() => Appearance.getColorScheme() ?? 'light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (!active) return;
      if (saved === 'light' || saved === 'dark') setSchemeState(saved);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setScheme = (s: Scheme) => {
    setSchemeState(s);
    void AsyncStorage.setItem(STORAGE_KEY, s);
  };

  const value = useMemo<ThemeValue>(
    () => ({
      scheme,
      ready,
      colors: scheme === 'dark' ? darkColors : lightColors,
      toggle: () => setScheme(scheme === 'dark' ? 'light' : 'dark'),
      setScheme,
    }),
    [scheme, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
