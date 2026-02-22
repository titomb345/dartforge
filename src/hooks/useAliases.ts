import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';
import type { Alias, AliasId, AliasMatchMode, AliasScope } from '../types/alias';

const ALIASES_FILE = 'aliases.json';
const SETTINGS_FILE = 'settings.json';
const GLOBAL_KEY = 'global';
const SPEEDWALK_KEY = 'enableSpeedwalk';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAliases(dataStore: DataStore, activeCharacter: string | null) {
  const [characterAliases, setCharacterAliases] = useState<Record<AliasId, Alias>>({});
  const [globalAliases, setGlobalAliases] = useState<Record<AliasId, Alias>>({});
  const [enableSpeedwalk, setEnableSpeedwalkState] = useState(true);

  const loadedRef = useRef(false);
  const charLoadedRef = useRef(false);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const activeCharRef = useRef(activeCharacter);
  activeCharRef.current = activeCharacter;

  // Load global aliases + speedwalk setting on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const savedGlobal = await dataStore.get<Record<AliasId, Alias>>(
          ALIASES_FILE,
          GLOBAL_KEY,
        );
        if (savedGlobal) setGlobalAliases(savedGlobal);

        const savedSpeedwalk = await dataStore.get<boolean>(SETTINGS_FILE, SPEEDWALK_KEY);
        if (savedSpeedwalk != null) setEnableSpeedwalkState(savedSpeedwalk);
      } catch (e) {
        console.error('Failed to load global aliases:', e);
      }
      loadedRef.current = true;
    })();
  }, [dataStore.ready]);

  // Load character-specific aliases when active character changes
  useEffect(() => {
    if (!dataStore.ready || !activeCharacter) {
      setCharacterAliases({});
      charLoadedRef.current = false;
      return;
    }
    const charKey = activeCharacter.toLowerCase();
    charLoadedRef.current = false;
    (async () => {
      try {
        const saved = await dataStore.get<Record<AliasId, Alias>>(ALIASES_FILE, charKey);
        setCharacterAliases(saved ?? {});
      } catch (e) {
        console.error('Failed to load character aliases:', e);
        setCharacterAliases({});
      }
      charLoadedRef.current = true;
    })();
  }, [dataStore.ready, activeCharacter]);

  // Persist global aliases on change
  useEffect(() => {
    if (!loadedRef.current) return;
    const ds = dataStoreRef.current;
    ds.set(ALIASES_FILE, GLOBAL_KEY, globalAliases)
      .then(() => ds.save(ALIASES_FILE))
      .catch(console.error);
  }, [globalAliases]);

  // Persist character aliases on change
  useEffect(() => {
    if (!charLoadedRef.current || !activeCharRef.current) return;
    const ds = dataStoreRef.current;
    const charKey = activeCharRef.current.toLowerCase();
    ds.set(ALIASES_FILE, charKey, characterAliases)
      .then(() => ds.save(ALIASES_FILE))
      .catch(console.error);
  }, [characterAliases]);

  // Persist speedwalk setting
  const setEnableSpeedwalk = useCallback(async (value: boolean) => {
    setEnableSpeedwalkState(value);
    try {
      const ds = dataStoreRef.current;
      await ds.set(SETTINGS_FILE, SPEEDWALK_KEY, value);
      await ds.save(SETTINGS_FILE);
    } catch (e) {
      console.error('Failed to save speedwalk setting:', e);
    }
  }, []);

  // --- CRUD ---

  const createAlias = useCallback(
    (
      partial: {
        pattern: string;
        matchMode: AliasMatchMode;
        body: string;
        group: string;
      },
      scope: AliasScope,
    ): AliasId => {
      const now = new Date().toISOString();
      const alias: Alias = {
        id: generateId(),
        pattern: partial.pattern,
        matchMode: partial.matchMode,
        body: partial.body,
        enabled: true,
        group: partial.group,
        createdAt: now,
        updatedAt: now,
      };

      if (scope === 'character') {
        setCharacterAliases((prev) => ({ ...prev, [alias.id]: alias }));
      } else {
        setGlobalAliases((prev) => ({ ...prev, [alias.id]: alias }));
      }
      return alias.id;
    },
    [],
  );

  const updateAlias = useCallback(
    (id: AliasId, updates: Partial<Omit<Alias, 'id' | 'createdAt'>>, scope: AliasScope) => {
      const now = new Date().toISOString();
      const updater = (prev: Record<AliasId, Alias>) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, ...updates, updatedAt: now } };
      };

      if (scope === 'character') {
        setCharacterAliases(updater);
      } else {
        setGlobalAliases(updater);
      }
    },
    [],
  );

  const deleteAlias = useCallback((id: AliasId, scope: AliasScope) => {
    const updater = (prev: Record<AliasId, Alias>) => {
      if (!prev[id]) return prev;
      const { [id]: _, ...rest } = prev;
      return rest;
    };

    if (scope === 'character') {
      setCharacterAliases(updater);
    } else {
      setGlobalAliases(updater);
    }
  }, []);

  const toggleAlias = useCallback((id: AliasId, scope: AliasScope) => {
    const updater = (prev: Record<AliasId, Alias>) => {
      const existing = prev[id];
      if (!existing) return prev;
      return {
        ...prev,
        [id]: { ...existing, enabled: !existing.enabled, updatedAt: new Date().toISOString() },
      };
    };

    if (scope === 'character') {
      setCharacterAliases(updater);
    } else {
      setGlobalAliases(updater);
    }
  }, []);

  const duplicateAlias = useCallback(
    (id: AliasId, scope: AliasScope): AliasId | null => {
      const source = scope === 'character' ? characterAliases : globalAliases;
      const original = source[id];
      if (!original) return null;

      return createAlias(
        {
          pattern: `${original.pattern}_copy`,
          matchMode: original.matchMode,
          body: original.body,
          group: original.group,
        },
        scope,
      );
    },
    [characterAliases, globalAliases, createAlias],
  );

  // Merged list for the expansion engine (character first for priority)
  const mergedAliases = useMemo(() => {
    const charList = Object.values(characterAliases);
    const globalList = Object.values(globalAliases);
    return [...charList, ...globalList];
  }, [characterAliases, globalAliases]);

  return {
    characterAliases,
    globalAliases,
    mergedAliases,
    enableSpeedwalk,
    setEnableSpeedwalk,
    createAlias,
    updateAlias,
    deleteAlias,
    toggleAlias,
    duplicateAlias,
  };
}
