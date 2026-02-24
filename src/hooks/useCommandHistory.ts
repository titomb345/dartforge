import { useState, useEffect, useCallback, useRef } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';

const SETTINGS_FILE = 'settings.json';

export function useCommandHistory(dataStore: DataStore) {
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      const saved = await dataStore.get<string[]>(SETTINGS_FILE, 'commandHistory');
      if (Array.isArray(saved)) setCommandHistory(saved);
      loadedRef.current = true;
    })().catch(console.error);
  }, [dataStore.ready]);

  const handleHistoryChange = useCallback(
    (history: string[]) => {
      setCommandHistory(history);
      dataStore
        .set(SETTINGS_FILE, 'commandHistory', history)
        .then(() => dataStore.save(SETTINGS_FILE))
        .catch(console.error);
    },
    [dataStore]
  );

  return { commandHistory, handleHistoryChange };
}
