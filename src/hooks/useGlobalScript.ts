import { useState, useEffect, useCallback, useRef } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';

const GLOBAL_SCRIPT_FILE = 'global-script.js';

/**
 * Manages the global script file — a shared JS file whose contents
 * are prepended to every script-mode trigger/alias body.
 */
export function useGlobalScript(dataStore: DataStore) {
  const [script, setScript] = useState('');
  const [loaded, setLoaded] = useState(false);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;

  // Load on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const saved = await dataStore.readText(GLOBAL_SCRIPT_FILE);
        if (saved != null) setScript(saved);
      } catch (e) {
        console.error('Failed to load global script:', e);
      }
      setLoaded(true);
    })();
  }, [dataStore.ready]);

  const saveScript = useCallback(async (content: string) => {
    setScript(content);
    try {
      await dataStoreRef.current.writeText(GLOBAL_SCRIPT_FILE, content);
    } catch (e) {
      console.error('Failed to save global script:', e);
    }
  }, []);

  return { script, saveScript, loaded };
}
