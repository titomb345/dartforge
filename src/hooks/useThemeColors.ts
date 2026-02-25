import { useState, useCallback, useEffect } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import { DEFAULT_THEME, type TerminalTheme, type ThemeColorKey } from '../lib/defaultTheme';
import { migrateSettings } from '../lib/settingsMigrations';

const STORE_FILE = 'settings.json';
const STORE_KEY = 'theme';
const DISPLAY_KEY = 'display';

const ALL_FONTS = [
  'Courier New',
  'Consolas',
  'Cascadia Code',
  'Fira Code',
  'JetBrains Mono',
  'Source Code Pro',
  'Lucida Console',
] as const;

/** Detect whether a font is installed by comparing canvas text width against a generic fallback. */
function isFontAvailable(fontFamily: string): boolean {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return true; // can't detect — assume available
  const text = 'abcdefghijklmnopqrstuvwxyz0123456789';
  ctx.font = '72px serif';
  const serifWidth = ctx.measureText(text).width;
  ctx.font = `72px '${fontFamily}', serif`;
  const testWidth = ctx.measureText(text).width;
  return serifWidth !== testWidth;
}

export const FONT_OPTIONS = ALL_FONTS.filter(isFontAvailable);

export const DEFAULT_DISPLAY = {
  fontSize: 14,
  fontFamily: 'Courier New' as string,
};

export type DisplaySettings = typeof DEFAULT_DISPLAY;

export function useThemeColors() {
  const dataStore = useDataStore();
  const [theme, setTheme] = useState<TerminalTheme>({ ...DEFAULT_THEME });
  const [display, setDisplay] = useState<DisplaySettings>({ ...DEFAULT_DISPLAY });
  const [loaded, setLoaded] = useState(false);

  // Load saved settings from store on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    let cancelled = false;
    (async () => {
      try {
        await migrateSettings(dataStore);
        if (cancelled) return;
        const savedTheme = await dataStore.get<Partial<TerminalTheme>>(STORE_FILE, STORE_KEY);
        if (cancelled) return;
        if (savedTheme) {
          setTheme({ ...DEFAULT_THEME, ...savedTheme });
        }
        const savedDisplay = await dataStore.get<Partial<DisplaySettings>>(STORE_FILE, DISPLAY_KEY);
        if (cancelled) return;
        if (savedDisplay) {
          // If saved font is no longer available, fall back to default
          if (
            savedDisplay.fontFamily &&
            !(FONT_OPTIONS as readonly string[]).includes(savedDisplay.fontFamily)
          ) {
            savedDisplay.fontFamily = DEFAULT_DISPLAY.fontFamily;
          }
          setDisplay({ ...DEFAULT_DISPLAY, ...savedDisplay });
        }
      } catch (e) {
        if (!cancelled) console.error('Failed to load settings from store:', e);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [dataStore.ready]);

  const updateColor = useCallback(
    (key: ThemeColorKey, value: string) => {
      setTheme((prev) => {
        const next = { ...prev, [key]: value };
        dataStore.set(STORE_FILE, STORE_KEY, next).catch(console.error);
        return next;
      });
    },
    [dataStore]
  );

  const resetColor = useCallback(
    (key: ThemeColorKey) => {
      setTheme((prev) => {
        const next = { ...prev, [key]: DEFAULT_THEME[key] };
        dataStore.set(STORE_FILE, STORE_KEY, next).catch(console.error);
        return next;
      });
    },
    [dataStore]
  );

  const resetColors = useCallback(() => {
    setTheme({ ...DEFAULT_THEME });
    dataStore.delete(STORE_FILE, STORE_KEY).catch(console.error);
  }, [dataStore]);

  const updateDisplay = useCallback(
    <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => {
      setDisplay((prev) => {
        const next = { ...prev, [key]: value };
        dataStore.set(STORE_FILE, DISPLAY_KEY, next).catch(console.error);
        return next;
      });
    },
    [dataStore]
  );

  const resetDisplay = useCallback(
    (key: keyof DisplaySettings) => {
      setDisplay((prev) => {
        const next = { ...prev, [key]: DEFAULT_DISPLAY[key] };
        dataStore.set(STORE_FILE, DISPLAY_KEY, next).catch(console.error);
        return next;
      });
    },
    [dataStore]
  );

  const resetAll = useCallback(() => {
    setTheme({ ...DEFAULT_THEME });
    setDisplay({ ...DEFAULT_DISPLAY });
    (async () => {
      await dataStore.delete(STORE_FILE, STORE_KEY);
      await dataStore.delete(STORE_FILE, DISPLAY_KEY);
    })().catch(console.error);
  }, [dataStore]);

  return {
    theme,
    updateColor,
    resetColor,
    resetColors,
    display,
    updateDisplay,
    resetDisplay,
    resetAll,
    loaded,
  };
}
