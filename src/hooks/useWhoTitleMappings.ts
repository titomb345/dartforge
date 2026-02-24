import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';
import type { WhoTitleId, WhoTitleMapping } from '../types/whoTitleMap';

const WHO_TITLES_FILE = 'who-titles.json';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useWhoTitleMappings(dataStore: DataStore, activeCharacter: string | null) {
  const [mappings, setMappings] = useState<Record<WhoTitleId, WhoTitleMapping>>({});

  const loadedRef = useRef(false);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const activeCharRef = useRef(activeCharacter);
  activeCharRef.current = activeCharacter;

  // Load character-specific mappings when active character changes
  useEffect(() => {
    if (!dataStore.ready || !activeCharacter) {
      setMappings({});
      loadedRef.current = false;
      return;
    }
    const charKey = activeCharacter.toLowerCase();
    loadedRef.current = false;
    (async () => {
      try {
        const saved = await dataStore.get<Record<WhoTitleId, WhoTitleMapping>>(
          WHO_TITLES_FILE,
          charKey
        );
        setMappings(saved ?? {});
      } catch (e) {
        console.error('Failed to load who title mappings:', e);
        setMappings({});
      }
      loadedRef.current = true;
    })();
  }, [dataStore.ready, activeCharacter]);

  // Persist on change
  useEffect(() => {
    if (!loadedRef.current || !activeCharRef.current) return;
    const ds = dataStoreRef.current;
    const charKey = activeCharRef.current.toLowerCase();
    ds.set(WHO_TITLES_FILE, charKey, mappings)
      .then(() => ds.save(WHO_TITLES_FILE))
      .catch(console.error);
  }, [mappings]);

  const createMapping = useCallback(
    (whoTitle: string, playerName: string, confirmed: boolean): WhoTitleId => {
      const id = generateId();
      const mapping: WhoTitleMapping = { id, whoTitle, playerName, confirmed };
      setMappings((prev) => ({ ...prev, [id]: mapping }));
      return id;
    },
    []
  );

  const updateMapping = useCallback(
    (id: WhoTitleId, updates: Partial<Omit<WhoTitleMapping, 'id'>>) => {
      setMappings((prev) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, ...updates } };
      });
    },
    []
  );

  const deleteMapping = useCallback((id: WhoTitleId) => {
    setMappings((prev) => {
      if (!prev[id]) return prev;
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Sorted list for display (alphabetical by who title)
  const sortedMappings = useMemo(() => {
    return Object.values(mappings).sort((a, b) => a.whoTitle.localeCompare(b.whoTitle));
  }, [mappings]);

  // Resolve a who title to its mapping (exact match)
  const resolveTitle = useCallback(
    (whoTitle: string): WhoTitleMapping | null => {
      for (const mapping of sortedMappings) {
        if (mapping.whoTitle === whoTitle) return mapping;
      }
      return null;
    },
    [sortedMappings]
  );

  return {
    mappings,
    sortedMappings,
    createMapping,
    updateMapping,
    deleteMapping,
    resolveTitle,
  };
}
