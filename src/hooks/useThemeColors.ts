import { useState, useCallback, useEffect } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { DEFAULT_THEME, type TerminalTheme, type ThemeColorKey } from '../lib/defaultTheme';

const STORE_FILE = 'settings.json';
const STORE_KEY = 'theme';

export function useThemeColors() {
  const [theme, setTheme] = useState<TerminalTheme>({ ...DEFAULT_THEME });
  const [loaded, setLoaded] = useState(false);

  // Load saved theme from store on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE);
        const saved = await store.get<Partial<TerminalTheme>>(STORE_KEY);
        if (saved) {
          setTheme({ ...DEFAULT_THEME, ...saved });
        }
      } catch (e) {
        console.error('Failed to load theme from store:', e);
      }
      setLoaded(true);
    })();
  }, []);

  const updateColor = useCallback((key: ThemeColorKey, value: string) => {
    setTheme((prev) => {
      const next = { ...prev, [key]: value };
      // Save async — fire and forget
      load(STORE_FILE).then((store) => store.set(STORE_KEY, next)).catch(console.error);
      return next;
    });
  }, []);

  const resetColor = useCallback((key: ThemeColorKey) => {
    setTheme((prev) => {
      const next = { ...prev, [key]: DEFAULT_THEME[key] };
      load(STORE_FILE).then((store) => store.set(STORE_KEY, next)).catch(console.error);
      return next;
    });
  }, []);

  const resetColors = useCallback(() => {
    setTheme({ ...DEFAULT_THEME });
    load(STORE_FILE).then((store) => store.delete(STORE_KEY)).catch(console.error);
  }, []);

  return { theme, updateColor, resetColor, resetColors, loaded };
}
