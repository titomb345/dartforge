import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';
import type { Variable, VariableId, VariableScope } from '../types/variable';

const VARIABLES_FILE = 'variables.json';
const GLOBAL_KEY = 'global';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useVariables(dataStore: DataStore, activeCharacter: string | null) {
  const [characterVariables, setCharacterVariables] = useState<Record<VariableId, Variable>>({});
  const [globalVariables, setGlobalVariables] = useState<Record<VariableId, Variable>>({});

  const loadedRef = useRef(false);
  const charLoadedRef = useRef(false);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const activeCharRef = useRef(activeCharacter);
  activeCharRef.current = activeCharacter;

  // Load global variables on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const savedGlobal = await dataStore.get<Record<VariableId, Variable>>(
          VARIABLES_FILE,
          GLOBAL_KEY
        );
        if (savedGlobal) setGlobalVariables(savedGlobal);
      } catch (e) {
        console.error('Failed to load global variables:', e);
      }
      loadedRef.current = true;
    })();
  }, [dataStore.ready]);

  // Load character-specific variables when active character changes
  useEffect(() => {
    if (!dataStore.ready || !activeCharacter) {
      setCharacterVariables({});
      charLoadedRef.current = false;
      return;
    }
    const charKey = activeCharacter.toLowerCase();
    charLoadedRef.current = false;
    (async () => {
      try {
        const saved = await dataStore.get<Record<VariableId, Variable>>(VARIABLES_FILE, charKey);
        setCharacterVariables(saved ?? {});
      } catch (e) {
        console.error('Failed to load character variables:', e);
        setCharacterVariables({});
      }
      charLoadedRef.current = true;
    })();
  }, [dataStore.ready, activeCharacter]);

  // Persist global variables on change
  useEffect(() => {
    if (!loadedRef.current) return;
    const ds = dataStoreRef.current;
    ds.set(VARIABLES_FILE, GLOBAL_KEY, globalVariables)
      .then(() => ds.save(VARIABLES_FILE))
      .catch(console.error);
  }, [globalVariables]);

  // Persist character variables on change
  useEffect(() => {
    if (!charLoadedRef.current || !activeCharRef.current) return;
    const ds = dataStoreRef.current;
    const charKey = activeCharRef.current.toLowerCase();
    ds.set(VARIABLES_FILE, charKey, characterVariables)
      .then(() => ds.save(VARIABLES_FILE))
      .catch(console.error);
  }, [characterVariables]);

  // --- CRUD ---

  const createVariable = useCallback(
    (partial: { name: string; value: string }, scope: VariableScope): VariableId => {
      const now = new Date().toISOString();
      const variable: Variable = {
        id: generateId(),
        name: partial.name,
        value: partial.value,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };

      if (scope === 'character') {
        setCharacterVariables((prev) => ({ ...prev, [variable.id]: variable }));
      } else {
        setGlobalVariables((prev) => ({ ...prev, [variable.id]: variable }));
      }
      return variable.id;
    },
    []
  );

  const updateVariable = useCallback(
    (
      id: VariableId,
      updates: Partial<Omit<Variable, 'id' | 'createdAt'>>,
      scope: VariableScope
    ) => {
      const now = new Date().toISOString();
      const updater = (prev: Record<VariableId, Variable>) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, ...updates, updatedAt: now } };
      };

      if (scope === 'character') {
        setCharacterVariables(updater);
      } else {
        setGlobalVariables(updater);
      }
    },
    []
  );

  const deleteVariable = useCallback((id: VariableId, scope: VariableScope) => {
    const updater = (prev: Record<VariableId, Variable>) => {
      if (!prev[id]) return prev;
      const { [id]: _, ...rest } = prev;
      return rest;
    };

    if (scope === 'character') {
      setCharacterVariables(updater);
    } else {
      setGlobalVariables(updater);
    }
  }, []);

  const toggleVariable = useCallback((id: VariableId, scope: VariableScope) => {
    const updater = (prev: Record<VariableId, Variable>) => {
      const existing = prev[id];
      if (!existing) return prev;
      return {
        ...prev,
        [id]: { ...existing, enabled: !existing.enabled, updatedAt: new Date().toISOString() },
      };
    };

    if (scope === 'character') {
      setCharacterVariables(updater);
    } else {
      setGlobalVariables(updater);
    }
  }, []);

  /**
   * Set a variable by name (create or update). Used by the /var command.
   * If a variable with the same name already exists in the given scope, updates it.
   */
  const setVariable = useCallback(
    (name: string, value: string, scope: VariableScope): void => {
      const source = scope === 'character' ? characterVariables : globalVariables;
      const existing = Object.values(source).find(
        (v) => v.name.toLowerCase() === name.toLowerCase()
      );

      if (existing) {
        updateVariable(existing.id, { value }, scope);
      } else {
        createVariable({ name, value }, scope);
      }
    },
    [characterVariables, globalVariables, updateVariable, createVariable]
  );

  /**
   * Delete a variable by name. Used by the /var -d command.
   * Searches character scope first, then global.
   */
  const deleteVariableByName = useCallback(
    (name: string): boolean => {
      const charMatch = Object.values(characterVariables).find(
        (v) => v.name.toLowerCase() === name.toLowerCase()
      );
      if (charMatch) {
        deleteVariable(charMatch.id, 'character');
        return true;
      }

      const globalMatch = Object.values(globalVariables).find(
        (v) => v.name.toLowerCase() === name.toLowerCase()
      );
      if (globalMatch) {
        deleteVariable(globalMatch.id, 'global');
        return true;
      }

      return false;
    },
    [characterVariables, globalVariables, deleteVariable]
  );

  // Merged list for expansion (character first for priority)
  const mergedVariables = useMemo(() => {
    const charList = Object.values(characterVariables);
    const globalList = Object.values(globalVariables);
    return [...charList, ...globalList];
  }, [characterVariables, globalVariables]);

  return useMemo(
    () => ({
      characterVariables,
      globalVariables,
      mergedVariables,
      createVariable,
      updateVariable,
      deleteVariable,
      toggleVariable,
      setVariable,
      deleteVariableByName,
    }),
    [
      characterVariables,
      globalVariables,
      mergedVariables,
      createVariable,
      updateVariable,
      deleteVariable,
      toggleVariable,
      setVariable,
      deleteVariableByName,
    ]
  );
}
