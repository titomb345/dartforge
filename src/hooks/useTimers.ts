import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';
import type { Timer, TimerId, TimerScope } from '../types/timer';

const TIMERS_FILE = 'timers.json';
const GLOBAL_KEY = 'global';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTimers(dataStore: DataStore, activeCharacter: string | null) {
  const [characterTimers, setCharacterTimers] = useState<Record<TimerId, Timer>>({});
  const [globalTimers, setGlobalTimers] = useState<Record<TimerId, Timer>>({});

  const loadedRef = useRef(false);
  const charLoadedRef = useRef(false);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const activeCharRef = useRef(activeCharacter);
  activeCharRef.current = activeCharacter;

  // Load global timers on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const savedGlobal = await dataStore.get<Record<TimerId, Timer>>(
          TIMERS_FILE,
          GLOBAL_KEY,
        );
        if (savedGlobal) setGlobalTimers(savedGlobal);
      } catch (e) {
        console.error('Failed to load global timers:', e);
      }
      loadedRef.current = true;
    })();
  }, [dataStore.ready]);

  // Load character-specific timers when active character changes
  useEffect(() => {
    if (!dataStore.ready || !activeCharacter) {
      setCharacterTimers({});
      charLoadedRef.current = false;
      return;
    }
    const charKey = activeCharacter.toLowerCase();
    charLoadedRef.current = false;
    (async () => {
      try {
        const saved = await dataStore.get<Record<TimerId, Timer>>(TIMERS_FILE, charKey);
        setCharacterTimers(saved ?? {});
      } catch (e) {
        console.error('Failed to load character timers:', e);
        setCharacterTimers({});
      }
      charLoadedRef.current = true;
    })();
  }, [dataStore.ready, activeCharacter]);

  // Persist global timers on change
  useEffect(() => {
    if (!loadedRef.current) return;
    const ds = dataStoreRef.current;
    ds.set(TIMERS_FILE, GLOBAL_KEY, globalTimers)
      .then(() => ds.save(TIMERS_FILE))
      .catch(console.error);
  }, [globalTimers]);

  // Persist character timers on change
  useEffect(() => {
    if (!charLoadedRef.current || !activeCharRef.current) return;
    const ds = dataStoreRef.current;
    const charKey = activeCharRef.current.toLowerCase();
    ds.set(TIMERS_FILE, charKey, characterTimers)
      .then(() => ds.save(TIMERS_FILE))
      .catch(console.error);
  }, [characterTimers]);

  // --- CRUD ---

  const createTimer = useCallback(
    (
      partial: {
        name: string;
        body: string;
        intervalSeconds: number;
        group: string;
      },
      scope: TimerScope,
    ): TimerId => {
      const now = new Date().toISOString();
      const timer: Timer = {
        id: generateId(),
        name: partial.name,
        body: partial.body,
        intervalSeconds: partial.intervalSeconds,
        enabled: true,
        group: partial.group,
        createdAt: now,
        updatedAt: now,
      };

      if (scope === 'character') {
        setCharacterTimers((prev) => ({ ...prev, [timer.id]: timer }));
      } else {
        setGlobalTimers((prev) => ({ ...prev, [timer.id]: timer }));
      }
      return timer.id;
    },
    [],
  );

  const updateTimer = useCallback(
    (id: TimerId, updates: Partial<Omit<Timer, 'id' | 'createdAt'>>, scope: TimerScope) => {
      const now = new Date().toISOString();
      const updater = (prev: Record<TimerId, Timer>) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, ...updates, updatedAt: now } };
      };

      if (scope === 'character') {
        setCharacterTimers(updater);
      } else {
        setGlobalTimers(updater);
      }
    },
    [],
  );

  const deleteTimer = useCallback((id: TimerId, scope: TimerScope) => {
    const updater = (prev: Record<TimerId, Timer>) => {
      if (!prev[id]) return prev;
      const { [id]: _, ...rest } = prev;
      return rest;
    };

    if (scope === 'character') {
      setCharacterTimers(updater);
    } else {
      setGlobalTimers(updater);
    }
  }, []);

  const toggleTimer = useCallback((id: TimerId, scope: TimerScope) => {
    const updater = (prev: Record<TimerId, Timer>) => {
      const existing = prev[id];
      if (!existing) return prev;
      return {
        ...prev,
        [id]: { ...existing, enabled: !existing.enabled, updatedAt: new Date().toISOString() },
      };
    };

    if (scope === 'character') {
      setCharacterTimers(updater);
    } else {
      setGlobalTimers(updater);
    }
  }, []);

  const duplicateTimer = useCallback(
    (id: TimerId, scope: TimerScope): TimerId | null => {
      const source = scope === 'character' ? characterTimers : globalTimers;
      const original = source[id];
      if (!original) return null;

      return createTimer(
        {
          name: `${original.name}_copy`,
          body: original.body,
          intervalSeconds: original.intervalSeconds,
          group: original.group,
        },
        scope,
      );
    },
    [characterTimers, globalTimers, createTimer],
  );

  // Merged list for the timer engine (character first for priority)
  const mergedTimers = useMemo(() => {
    const charList = Object.values(characterTimers);
    const globalList = Object.values(globalTimers);
    return [...charList, ...globalList];
  }, [characterTimers, globalTimers]);

  return {
    characterTimers,
    globalTimers,
    mergedTimers,
    createTimer,
    updateTimer,
    deleteTimer,
    toggleTimer,
    duplicateTimer,
  };
}
