import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';
import type { Trigger, TriggerId, TriggerMatchMode, TriggerScope } from '../types/trigger';

const TRIGGERS_FILE = 'triggers.json';
const GLOBAL_KEY = 'global';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTriggers(dataStore: DataStore, activeCharacter: string | null) {
  const [characterTriggers, setCharacterTriggers] = useState<Record<TriggerId, Trigger>>({});
  const [globalTriggers, setGlobalTriggers] = useState<Record<TriggerId, Trigger>>({});

  const loadedRef = useRef(false);
  const charLoadedRef = useRef(false);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const activeCharRef = useRef(activeCharacter);
  activeCharRef.current = activeCharacter;

  // Load global triggers on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const savedGlobal = await dataStore.get<Record<TriggerId, Trigger>>(
          TRIGGERS_FILE,
          GLOBAL_KEY,
        );
        if (savedGlobal) setGlobalTriggers(savedGlobal);
      } catch (e) {
        console.error('Failed to load global triggers:', e);
      }
      loadedRef.current = true;
    })();
  }, [dataStore.ready]);

  // Load character-specific triggers when active character changes
  useEffect(() => {
    if (!dataStore.ready || !activeCharacter) {
      setCharacterTriggers({});
      charLoadedRef.current = false;
      return;
    }
    const charKey = activeCharacter.toLowerCase();
    charLoadedRef.current = false;
    (async () => {
      try {
        const saved = await dataStore.get<Record<TriggerId, Trigger>>(TRIGGERS_FILE, charKey);
        setCharacterTriggers(saved ?? {});
      } catch (e) {
        console.error('Failed to load character triggers:', e);
        setCharacterTriggers({});
      }
      charLoadedRef.current = true;
    })();
  }, [dataStore.ready, activeCharacter]);

  // Persist global triggers on change
  useEffect(() => {
    if (!loadedRef.current) return;
    const ds = dataStoreRef.current;
    ds.set(TRIGGERS_FILE, GLOBAL_KEY, globalTriggers)
      .then(() => ds.save(TRIGGERS_FILE))
      .catch(console.error);
  }, [globalTriggers]);

  // Persist character triggers on change
  useEffect(() => {
    if (!charLoadedRef.current || !activeCharRef.current) return;
    const ds = dataStoreRef.current;
    const charKey = activeCharRef.current.toLowerCase();
    ds.set(TRIGGERS_FILE, charKey, characterTriggers)
      .then(() => ds.save(TRIGGERS_FILE))
      .catch(console.error);
  }, [characterTriggers]);

  // --- CRUD ---

  const createTrigger = useCallback(
    (
      partial: {
        pattern: string;
        matchMode: TriggerMatchMode;
        body: string;
        group: string;
        cooldownMs?: number;
        gag?: boolean;
        highlight?: string | null;
        soundAlert?: boolean;
      },
      scope: TriggerScope,
    ): TriggerId => {
      const now = new Date().toISOString();
      const trigger: Trigger = {
        id: generateId(),
        pattern: partial.pattern,
        matchMode: partial.matchMode,
        body: partial.body,
        enabled: true,
        group: partial.group,
        cooldownMs: partial.cooldownMs ?? 0,
        gag: partial.gag ?? false,
        highlight: partial.highlight ?? null,
        soundAlert: partial.soundAlert ?? false,
        createdAt: now,
        updatedAt: now,
      };

      if (scope === 'character') {
        setCharacterTriggers((prev) => ({ ...prev, [trigger.id]: trigger }));
      } else {
        setGlobalTriggers((prev) => ({ ...prev, [trigger.id]: trigger }));
      }
      return trigger.id;
    },
    [],
  );

  const updateTrigger = useCallback(
    (id: TriggerId, updates: Partial<Omit<Trigger, 'id' | 'createdAt'>>, scope: TriggerScope) => {
      const now = new Date().toISOString();
      const updater = (prev: Record<TriggerId, Trigger>) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, ...updates, updatedAt: now } };
      };

      if (scope === 'character') {
        setCharacterTriggers(updater);
      } else {
        setGlobalTriggers(updater);
      }
    },
    [],
  );

  const deleteTrigger = useCallback((id: TriggerId, scope: TriggerScope) => {
    const updater = (prev: Record<TriggerId, Trigger>) => {
      if (!prev[id]) return prev;
      const { [id]: _, ...rest } = prev;
      return rest;
    };

    if (scope === 'character') {
      setCharacterTriggers(updater);
    } else {
      setGlobalTriggers(updater);
    }
  }, []);

  const toggleTrigger = useCallback((id: TriggerId, scope: TriggerScope) => {
    const updater = (prev: Record<TriggerId, Trigger>) => {
      const existing = prev[id];
      if (!existing) return prev;
      return {
        ...prev,
        [id]: { ...existing, enabled: !existing.enabled, updatedAt: new Date().toISOString() },
      };
    };

    if (scope === 'character') {
      setCharacterTriggers(updater);
    } else {
      setGlobalTriggers(updater);
    }
  }, []);

  const duplicateTrigger = useCallback(
    (id: TriggerId, scope: TriggerScope): TriggerId | null => {
      const source = scope === 'character' ? characterTriggers : globalTriggers;
      const original = source[id];
      if (!original) return null;

      return createTrigger(
        {
          pattern: `${original.pattern}_copy`,
          matchMode: original.matchMode,
          body: original.body,
          group: original.group,
          cooldownMs: original.cooldownMs,
          gag: original.gag,
          highlight: original.highlight,
          soundAlert: original.soundAlert,
        },
        scope,
      );
    },
    [characterTriggers, globalTriggers, createTrigger],
  );

  // Merged list for the trigger engine (character first for priority)
  const mergedTriggers = useMemo(() => {
    const charList = Object.values(characterTriggers);
    const globalList = Object.values(globalTriggers);
    return [...charList, ...globalList];
  }, [characterTriggers, globalTriggers]);

  return {
    characterTriggers,
    globalTriggers,
    mergedTriggers,
    createTrigger,
    updateTrigger,
    deleteTrigger,
    toggleTrigger,
    duplicateTrigger,
  };
}
