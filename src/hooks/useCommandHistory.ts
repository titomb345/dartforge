import { useState, useEffect, useCallback, useRef } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';

const SETTINGS_FILE = 'settings.json';
const HISTORY_FILE = 'command-history.json';
/** Pre-1.16 key in settings.json — history used to be shared by every character. */
const LEGACY_HISTORY_KEY = 'commandHistory';
const historyKey = (char: string) => `history:${char}`;

export function useCommandHistory(dataStore: DataStore, activeCharacter: string | null) {
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const loadedRef = useRef(false);
  /** Character key the in-memory history belongs to. */
  const historyCharRef = useRef<string | null>(null);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;

  const charKey = activeCharacter ? activeCharacter.toLowerCase() : null;

  // Load the active character's history, swapping it when the character
  // changes. Nothing is loaded or persisted until a character is known, so the
  // login prompt never writes into someone else's history.
  useEffect(() => {
    if (!dataStore.ready) return;
    const ds = dataStoreRef.current;

    loadedRef.current = false;
    historyCharRef.current = charKey;

    if (!charKey) return;

    let cancelled = false;
    (async () => {
      try {
        let saved = await ds.get<string[]>(HISTORY_FILE, historyKey(charKey));

        // Command history used to be shared by every character, kept in
        // settings.json. The first character to load after upgrading adopts it
        // (that's whoever was last played) and the shared key is retired.
        if (saved == null) {
          const legacy = await ds.get<string[]>(SETTINGS_FILE, LEGACY_HISTORY_KEY);
          if (Array.isArray(legacy)) {
            saved = legacy;
            await ds.set(HISTORY_FILE, historyKey(charKey), legacy);
            await ds.save(HISTORY_FILE);
            await ds.delete(SETTINGS_FILE, LEGACY_HISTORY_KEY);
            await ds.save(SETTINGS_FILE);
          }
        }

        if (cancelled) return;
        setCommandHistory(Array.isArray(saved) ? saved : []);
      } catch (e) {
        console.error('Failed to load command history:', e);
        if (!cancelled) setCommandHistory([]);
      }
      if (!cancelled) loadedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [dataStore.ready, charKey]);

  const handleHistoryChange = useCallback((history: string[]) => {
    setCommandHistory(history);
    const char = historyCharRef.current;
    if (!loadedRef.current || !char) return;
    const ds = dataStoreRef.current;
    ds.set(HISTORY_FILE, historyKey(char), history)
      .then(() => ds.save(HISTORY_FILE))
      .catch(console.error);
  }, []);

  return { commandHistory, handleHistoryChange };
}
