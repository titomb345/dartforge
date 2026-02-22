import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';
import type { SignatureId, SignatureMapping } from '../types/signatureMap';

const SIGNATURES_FILE = 'signatures.json';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SignatureResolution {
  playerName: string;
  message: string;
}

export function useSignatureMappings(dataStore: DataStore, activeCharacter: string | null) {
  const [mappings, setMappings] = useState<Record<SignatureId, SignatureMapping>>({});

  const loadedRef = useRef(false);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const activeCharRef = useRef(activeCharacter);
  activeCharRef.current = activeCharacter;

  // Load character-specific signatures when active character changes
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
        const saved = await dataStore.get<Record<SignatureId, SignatureMapping>>(
          SIGNATURES_FILE,
          charKey,
        );
        setMappings(saved ?? {});
      } catch (e) {
        console.error('Failed to load signature mappings:', e);
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
    ds.set(SIGNATURES_FILE, charKey, mappings)
      .then(() => ds.save(SIGNATURES_FILE))
      .catch(console.error);
  }, [mappings]);

  const createMapping = useCallback((signature: string, playerName: string): SignatureId => {
    const id = generateId();
    const mapping: SignatureMapping = { id, signature, playerName };
    setMappings((prev) => ({ ...prev, [id]: mapping }));
    return id;
  }, []);

  const updateMapping = useCallback(
    (id: SignatureId, updates: Partial<Omit<SignatureMapping, 'id'>>) => {
      setMappings((prev) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, ...updates } };
      });
    },
    [],
  );

  const deleteMapping = useCallback((id: SignatureId) => {
    setMappings((prev) => {
      if (!prev[id]) return prev;
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Sorted list for resolution (longest signature first for greedy matching)
  const sortedMappings = useMemo(() => {
    return Object.values(mappings).sort((a, b) => b.signature.length - a.signature.length);
  }, [mappings]);

  // Resolve a message body against all known signatures
  const resolveSignature = useCallback(
    (messageBody: string): SignatureResolution | null => {
      for (const mapping of sortedMappings) {
        if (messageBody.endsWith(mapping.signature)) {
          const stripped = messageBody.slice(0, -mapping.signature.length).trimEnd();
          return { playerName: mapping.playerName, message: stripped };
        }
      }
      return null;
    },
    [sortedMappings],
  );

  return {
    mappings,
    sortedMappings,
    createMapping,
    updateMapping,
    deleteMapping,
    resolveSignature,
  };
}
