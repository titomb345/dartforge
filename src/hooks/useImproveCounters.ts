import { useState, useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import type { ImproveCounter, CounterStatus } from '../types/counter';
import type { SkillMatchResult } from '../types/skills';

const COUNTERS_FILE = 'counters.json';
const SETTINGS_FILE = 'settings.json';
const SAVE_INTERVAL_MS = 30_000; // periodic save for running counters

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeCounter(name: string): ImproveCounter {
  return {
    id: generateId(),
    name,
    status: 'stopped',
    skills: {},
    totalImps: 0,
    startedAt: null,
    accumulatedMs: 0,
    lastResumedAt: null,
    periodStartAt: null,
    impsInCurrentPeriod: 0,
  };
}

/** Migrate counters saved with old ISO-string format to epoch-ms numbers */
function migrateCounter(c: ImproveCounter & Record<string, unknown>): ImproveCounter {
  // Handle old field name (lastTickAt → lastResumedAt)
  let lastResumedAt: number | null = (c.lastResumedAt as number | null) ?? null;
  const oldTick = c.lastTickAt as string | number | null | undefined;
  if (oldTick != null && lastResumedAt == null) {
    lastResumedAt = typeof oldTick === 'string' ? new Date(oldTick).getTime() : oldTick;
  } else if (typeof lastResumedAt === 'string') {
    lastResumedAt = new Date(lastResumedAt as unknown as string).getTime();
  }

  let periodStartAt: number | null = c.periodStartAt;
  if (typeof periodStartAt === 'string') {
    periodStartAt = new Date(periodStartAt as unknown as string).getTime();
  }

  return {
    id: c.id,
    name: c.name,
    status: c.status,
    skills: c.skills,
    totalImps: c.totalImps,
    startedAt: c.startedAt,
    accumulatedMs: c.accumulatedMs,
    lastResumedAt,
    periodStartAt,
    impsInCurrentPeriod: c.impsInCurrentPeriod,
  };
}

export interface SkillTally {
  skill: string;
  count: number;
}

export function useImproveCounters() {
  const dataStore = useDataStore();
  const [counters, setCounters] = useState<ImproveCounter[]>([]);
  const [activeCounterId, setActiveCounterId] = useState<string | null>(null);
  const [periodLengthMinutes, setPeriodLengthMinutesState] = useState(10);
  const [tick, setTick] = useState(0);
  const loaded = useRef(false);
  const lastImproveRef = useRef<{ skill: string } | null>(null);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;

  // Load from counters.json on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const savedCounters = await dataStore.get<ImproveCounter[]>(COUNTERS_FILE, 'counters');
        const savedActiveId = await dataStore.get<string | null>(COUNTERS_FILE, 'activeCounterId');
        const savedPeriod = await dataStore.get<number>(SETTINGS_FILE, 'counterPeriodLength');

        if (savedPeriod != null) setPeriodLengthMinutesState(savedPeriod);

        if (savedCounters && savedCounters.length > 0) {
          const now = Date.now();
          const periodMs = (savedPeriod ?? 10) * 60_000;

          // Migrate old format + resume running counters
          const resumed = savedCounters.map((raw) => {
            const c = migrateCounter(raw as ImproveCounter & Record<string, unknown>);
            if (c.status === 'running' && c.lastResumedAt) {
              const gap = now - c.lastResumedAt;
              const updated = { ...c, accumulatedMs: c.accumulatedMs + gap, lastResumedAt: now };
              // Check if period expired during gap
              if (updated.periodStartAt) {
                const periodElapsed = now - updated.periodStartAt;
                if (periodElapsed > periodMs) {
                  updated.periodStartAt = now;
                  updated.impsInCurrentPeriod = 0;
                }
              }
              return updated;
            }
            return c;
          });

          setCounters(resumed);
          setActiveCounterId(savedActiveId ?? resumed[0]?.id ?? null);
        }
      } catch (e) {
        console.error('Failed to load counter data:', e);
      }
      loaded.current = true;
    })();
  }, [dataStore.ready]);

  // Save helper
  const saveCounters = useCallback(async (data: ImproveCounter[], activeId: string | null) => {
    try {
      const ds = dataStoreRef.current;
      await ds.set(COUNTERS_FILE, 'counters', data);
      await ds.set(COUNTERS_FILE, 'activeCounterId', activeId);
      await ds.save(COUNTERS_FILE);
    } catch (e) {
      console.error('Failed to save counter data:', e);
    }
  }, []);

  // Persist on change
  useEffect(() => {
    if (!loaded.current) return;
    saveCounters(counters, activeCounterId);
  }, [counters, activeCounterId, saveCounters]);

  // Derive a stable boolean for whether any counter is running
  const hasRunning = counters.some((c) => c.status === 'running');

  // 1-second tick for live elapsed display
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  // Periodic save for running counters — flush elapsed into accumulatedMs
  useEffect(() => {
    if (!hasRunning || !loaded.current) return;
    const id = setInterval(() => {
      setCounters((prev) => {
        const now = Date.now();
        return prev.map((c) => {
          if (c.status !== 'running' || !c.lastResumedAt) return c;
          return {
            ...c,
            accumulatedMs: c.accumulatedMs + (now - c.lastResumedAt),
            lastResumedAt: now,
          };
        });
      });
    }, SAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasRunning]);

  // --- CRUD ---
  const createCounter = useCallback((name: string): string => {
    const counter = makeCounter(name);
    setCounters((prev) => [...prev, counter]);
    setActiveCounterId(counter.id);
    return counter.id;
  }, []);

  const deleteCounter = useCallback((id: string) => {
    setCounters((prev) => {
      const next = prev.filter((c) => c.id !== id);
      return next;
    });
    setActiveCounterId((prevActive) => {
      if (prevActive === id) {
        // Switch to another counter
        const remaining = counters.filter((c) => c.id !== id);
        return remaining[0]?.id ?? null;
      }
      return prevActive;
    });
  }, [counters]);

  const renameCounter = useCallback((id: string, name: string) => {
    setCounters((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name } : c)),
    );
  }, []);

  // --- Controls ---
  const startCounter = useCallback((id: string) => {
    const now = Date.now();
    setCounters((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        return {
          ...c,
          status: 'running' as CounterStatus,
          startedAt: c.startedAt ?? new Date(now).toISOString(),
          lastResumedAt: now,
          periodStartAt: c.periodStartAt ?? now,
        };
      }),
    );
  }, []);

  const pauseCounter = useCallback((id: string) => {
    const now = Date.now();
    setCounters((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.status !== 'running') return c;
        const elapsed = c.lastResumedAt ? now - c.lastResumedAt : 0;
        return {
          ...c,
          status: 'paused' as CounterStatus,
          accumulatedMs: c.accumulatedMs + elapsed,
          lastResumedAt: null,
        };
      }),
    );
  }, []);

  const resumeCounter = useCallback((id: string) => {
    const now = Date.now();
    setCounters((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.status !== 'paused') return c;
        return { ...c, status: 'running' as CounterStatus, lastResumedAt: now };
      }),
    );
  }, []);

  const stopCounter = useCallback((id: string) => {
    const now = Date.now();
    setCounters((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.status === 'stopped') return c;
        const elapsed = c.status === 'running' && c.lastResumedAt
          ? now - c.lastResumedAt
          : 0;
        return {
          ...c,
          status: 'stopped' as CounterStatus,
          accumulatedMs: c.accumulatedMs + elapsed,
          lastResumedAt: null,
        };
      }),
    );
  }, []);

  const clearCounter = useCallback((id: string) => {
    setCounters((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        return {
          ...c,
          status: 'stopped' as CounterStatus,
          skills: {},
          totalImps: 0,
          startedAt: null,
          accumulatedMs: 0,
          lastResumedAt: null,
          periodStartAt: null,
          impsInCurrentPeriod: 0,
        };
      }),
    );
  }, []);

  // --- Match handler (called from App.tsx onOutputChunk) ---
  const handleCounterMatch = useCallback((match: SkillMatchResult) => {
    if (match.type === 'shown-skill') return;

    if (match.type === 'self-improve' || match.type === 'pet-improve') {
      const skill = match.skill;
      lastImproveRef.current = { skill };

      setCounters((prev) => {
        const now = Date.now();
        return prev.map((c) => {
          if (c.status !== 'running') return c;

          // Check period rollover
          let periodStart = c.periodStartAt;
          let periodImps = c.impsInCurrentPeriod;
          if (periodStart) {
            const periodElapsed = now - periodStart;
            if (periodElapsed > periodLengthMinutes * 60_000) {
              periodStart = now;
              periodImps = 0;
            }
          } else {
            periodStart = now;
            periodImps = 0;
          }

          return {
            ...c,
            skills: { ...c.skills, [skill]: (c.skills[skill] ?? 0) + 1 },
            totalImps: c.totalImps + 1,
            periodStartAt: periodStart,
            impsInCurrentPeriod: periodImps + 1,
          };
        });
      });
    } else if (match.type === 'mistake') {
      const last = lastImproveRef.current;
      if (!last) return;
      lastImproveRef.current = null;

      setCounters((prev) =>
        prev.map((c) => {
          if (c.status !== 'running') return c;
          const skillCount = c.skills[last.skill];
          if (!skillCount) return c;
          const newSkills = { ...c.skills };
          const newCount = Math.max(0, skillCount - 1);
          if (newCount === 0) {
            delete newSkills[last.skill];
          } else {
            newSkills[last.skill] = newCount;
          }
          return {
            ...c,
            skills: newSkills,
            totalImps: Math.max(0, c.totalImps - 1),
            impsInCurrentPeriod: Math.max(0, c.impsInCurrentPeriod - 1),
          };
        }),
      );
    }
  }, [periodLengthMinutes]);

  // --- Computed helpers ---
  const getElapsedMs = useCallback((counter: ImproveCounter): number => {
    void tick;
    if (counter.status === 'running' && counter.lastResumedAt) {
      return counter.accumulatedMs + (Date.now() - counter.lastResumedAt);
    }
    return counter.accumulatedMs;
  }, [tick]);

  const getPerMinuteRate = useCallback((counter: ImproveCounter): number => {
    const elapsed = getElapsedMs(counter);
    if (elapsed <= 0) return 0;
    return counter.totalImps / (elapsed / 60_000);
  }, [getElapsedMs]);

  const getPerPeriodRate = useCallback((counter: ImproveCounter): number => {
    const elapsed = getElapsedMs(counter);
    if (elapsed <= 0) return 0;
    return counter.totalImps / (elapsed / (periodLengthMinutes * 60_000));
  }, [getElapsedMs, periodLengthMinutes]);

  const getPerHourRate = useCallback((counter: ImproveCounter): number => {
    const elapsed = getElapsedMs(counter);
    if (elapsed <= 0) return 0;
    return counter.totalImps / (elapsed / 3_600_000);
  }, [getElapsedMs]);

  const getSkillsSorted = useCallback((counter: ImproveCounter): SkillTally[] => {
    return Object.entries(counter.skills)
      .map(([skill, count]) => ({ skill, count }))
      .sort((a, b) => b.count - a.count);
  }, []);

  const getSkillPeriodRate = useCallback((counter: ImproveCounter, skill: string): number => {
    const elapsed = getElapsedMs(counter);
    if (elapsed <= 0) return 0;
    const count = counter.skills[skill] ?? 0;
    return count / (elapsed / (periodLengthMinutes * 60_000));
  }, [getElapsedMs, periodLengthMinutes]);

  const setPeriodLength = useCallback(async (minutes: number) => {
    const clamped = Math.max(1, Math.min(60, minutes));
    setPeriodLengthMinutesState(clamped);
    try {
      const ds = dataStoreRef.current;
      await ds.set(SETTINGS_FILE, 'counterPeriodLength', clamped);
      await ds.save(SETTINGS_FILE);
    } catch (e) {
      console.error('Failed to save counter period length:', e);
    }
  }, []);

  return {
    counters,
    activeCounterId,
    periodLengthMinutes,
    setActiveCounterId,
    createCounter,
    deleteCounter,
    renameCounter,
    startCounter,
    pauseCounter,
    resumeCounter,
    stopCounter,
    clearCounter,
    handleCounterMatch,
    setPeriodLength,
    getElapsedMs,
    getPerMinuteRate,
    getPerPeriodRate,
    getPerHourRate,
    getSkillsSorted,
    getSkillPeriodRate,
  };
}
