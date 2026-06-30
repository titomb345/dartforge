import { useState, useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import type { ImproveCounter, CounterStatus } from '../types/counter';
import type { SkillMatchResult } from '../types/skills';

const COUNTERS_FILE = 'counters.json';
const SETTINGS_FILE = 'settings.json';
const SAVE_INTERVAL_MS = 30_000; // periodic save for running counters
const HEARTBEAT_MS = 1_000; // liveness tick / suspension detector
// A gap between heartbeats larger than this means the app or machine was
// suspended (sleep, tab throttling, etc.) — that span is NOT counted as
// active time.
const SUSPEND_GAP_MS = 5_000;
// Hard cap on a single credited running segment. A continuous awake segment is
// flushed well within SAVE_INTERVAL_MS, so this only ever truncates a
// suspension gap that slipped past the heartbeat (e.g. acting in the < 1s
// window right after wake). Must be larger than SAVE_INTERVAL_MS.
const MAX_SEGMENT_MS = SAVE_INTERVAL_MS + SUSPEND_GAP_MS;

/**
 * Active milliseconds elapsed in the current running segment, clamped so a
 * suspended span (sleep/throttle) isn't counted as active time.
 */
export function awakeMs(lastResumedAt: number, now: number): number {
  return Math.min(Math.max(0, now - lastResumedAt), MAX_SEGMENT_MS);
}

/**
 * Total active ms for a counter: the frozen `accumulatedMs` plus, if running,
 * the awake time since it last resumed. Frozen whenever the counter isn't
 * running, so anything derived from it (elapsed, rates, the period window)
 * freezes on pause/stop.
 */
export function activeElapsed(c: ImproveCounter, now: number): number {
  if (c.status === 'running' && c.lastResumedAt) {
    return c.accumulatedMs + awakeMs(c.lastResumedAt, now);
  }
  return c.accumulatedMs;
}

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
    periodStartActiveMs: null,
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

  // Period model: new installs and already-migrated data carry
  // `periodStartActiveMs` (active-time domain). Old data only has the
  // wall-clock `periodStartAt` timestamp — convert it once by starting a fresh
  // period window at the counter's current active mark (accumulatedMs) if it
  // had a live period, else null.
  const raw = c as Record<string, unknown>;
  let periodStartActiveMs: number | null;
  if (raw.periodStartActiveMs !== undefined) {
    periodStartActiveMs = raw.periodStartActiveMs as number | null;
  } else {
    const hadLivePeriod = raw.periodStartAt != null && c.status !== 'stopped';
    periodStartActiveMs = hadLivePeriod ? c.accumulatedMs : null;
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
    periodStartActiveMs,
    impsInCurrentPeriod: c.impsInCurrentPeriod,
    archived: c.archived ?? false,
    order: c.order,
  };
}

export interface SkillTally {
  skill: string;
  count: number;
}

export interface PeriodProgress {
  /** Improves counted in the current period window. */
  imps: number;
  /** Active ms elapsed in the current window (clamped to periodMs). */
  elapsedMs: number;
  /** Total length of a period window in ms. */
  periodMs: number;
  /** Ms remaining before the window rolls over. */
  remainingMs: number;
  /** Whether the counter is running (a live window exists). */
  active: boolean;
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

          // Migrate old format + resume running counters. The period window is
          // active-time based, so the offline gap counts as neither active time
          // nor period progress — just resume timing from now without touching
          // the period (it picks up exactly where it left off).
          const resumed = savedCounters.map((raw) => {
            const c = migrateCounter(raw as ImproveCounter & Record<string, unknown>);
            if (c.status === 'running' && c.lastResumedAt) {
              // Don't add offline gap — only count time while app is open
              return { ...c, lastResumedAt: now };
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

  // Heartbeat: drives the live elapsed display and detects suspension gaps.
  // If the interval fires much later than expected (machine slept, tab was
  // throttled), the missed span is treated as inactive: we credit only the
  // awake time up to the last beat and resume timing from now, so the gap is
  // never counted.
  const lastBeatRef = useRef(0);
  useEffect(() => {
    if (!hasRunning) return;
    lastBeatRef.current = Date.now();
    const periodMs = periodLengthMinutes * 60_000;
    const id = setInterval(() => {
      const now = Date.now();
      const gap = now - lastBeatRef.current;
      lastBeatRef.current = now;
      const suspended = gap > SUSPEND_GAP_MS;
      const lastBeat = now - gap;
      setCounters((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          if (c.status !== 'running' || !c.lastResumedAt) return c;
          let updated = c;
          // Suspension gap (sleep/throttle): credit only awake time up to the
          // last beat, then resume timing from now so the gap isn't counted.
          if (suspended) {
            updated = {
              ...updated,
              accumulatedMs: updated.accumulatedMs + Math.max(0, lastBeat - c.lastResumedAt),
              lastResumedAt: now,
            };
            changed = true;
          }
          // Timer-driven period rollover so the live "this period" readout and
          // countdown stay honest even when no improves are arriving (the
          // per-improve handler also rolls, but only when an improve lands).
          // Measured in active time, so a paused/slept stretch never rolls it.
          if (updated.periodStartActiveMs != null) {
            const over = activeElapsed(updated, now) - updated.periodStartActiveMs;
            if (over >= periodMs) {
              updated = {
                ...updated,
                periodStartActiveMs:
                  updated.periodStartActiveMs + Math.floor(over / periodMs) * periodMs,
                impsInCurrentPeriod: 0,
              };
              changed = true;
            }
          }
          return updated;
        });
        // Return the same reference when nothing changed so the periodic-save
        // effect doesn't fire every heartbeat.
        return changed ? next : prev;
      });
      setTick((t) => t + 1);
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [hasRunning, periodLengthMinutes]);

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
            accumulatedMs: c.accumulatedMs + awakeMs(c.lastResumedAt, now),
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

  const deleteCounter = useCallback(
    (id: string) => {
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
    },
    [counters]
  );

  const renameCounter = useCallback((id: string, name: string) => {
    setCounters((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
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
          // Start a period at the current active mark if one isn't already
          // open (a stopped counter keeps its window so it resumes in place).
          periodStartActiveMs: c.periodStartActiveMs ?? c.accumulatedMs,
        };
      })
    );
  }, []);

  const pauseCounter = useCallback((id: string) => {
    const now = Date.now();
    setCounters((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.status !== 'running') return c;
        const elapsed = c.lastResumedAt ? awakeMs(c.lastResumedAt, now) : 0;
        return {
          ...c,
          status: 'paused' as CounterStatus,
          accumulatedMs: c.accumulatedMs + elapsed,
          lastResumedAt: null,
        };
      })
    );
  }, []);

  const resumeCounter = useCallback((id: string) => {
    const now = Date.now();
    setCounters((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.status !== 'paused') return c;
        return { ...c, status: 'running' as CounterStatus, lastResumedAt: now };
      })
    );
  }, []);

  const stopCounter = useCallback((id: string) => {
    const now = Date.now();
    setCounters((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.status === 'stopped') return c;
        const elapsed = c.status === 'running' && c.lastResumedAt ? awakeMs(c.lastResumedAt, now) : 0;
        return {
          ...c,
          status: 'stopped' as CounterStatus,
          accumulatedMs: c.accumulatedMs + elapsed,
          lastResumedAt: null,
        };
      })
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
          periodStartActiveMs: null,
          impsInCurrentPeriod: 0,
        };
      })
    );
  }, []);

  const archiveCounter = useCallback(
    (id: string) => {
      // Stop if running/paused before archiving
      const now = Date.now();
      setCounters((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const elapsed = c.status === 'running' && c.lastResumedAt ? awakeMs(c.lastResumedAt, now) : 0;
          return {
            ...c,
            archived: true,
            status: 'stopped' as CounterStatus,
            accumulatedMs: c.accumulatedMs + elapsed,
            lastResumedAt: null,
          };
        })
      );
      // Switch active to another non-archived counter if needed
      setActiveCounterId((prevActive) => {
        if (prevActive === id) {
          const remaining = counters.filter((c) => c.id !== id && !c.archived);
          return remaining[0]?.id ?? null;
        }
        return prevActive;
      });
    },
    [counters]
  );

  const unarchiveCounter = useCallback((id: string) => {
    setCounters((prev) =>
      prev.map((c) => (c.id === id ? { ...c, archived: false } : c))
    );
    setActiveCounterId(id);
  }, []);

  const reorderCounters = useCallback((ids: string[]) => {
    setCounters((prev) =>
      prev.map((c) => {
        const idx = ids.indexOf(c.id);
        return idx >= 0 ? { ...c, order: idx } : c;
      })
    );
  }, []);

  // --- Match handler (called from App.tsx onOutputChunk) ---
  const handleCounterMatch = useCallback(
    (match: SkillMatchResult) => {
      if (match.type === 'shown-skill') return;

      if (match.type === 'self-improve' || match.type === 'pet-improve') {
        const skill = match.skill;
        lastImproveRef.current = { skill };

        setCounters((prev) => {
          const now = Date.now();
          const periodMs = periodLengthMinutes * 60_000;
          return prev.map((c) => {
            if (c.status !== 'running') return c;

            // Roll the period window if the active-time elapsed since it began
            // has passed a full period (fallback to the heartbeat's rollover).
            const active = activeElapsed(c, now);
            let periodStart = c.periodStartActiveMs;
            let periodImps = c.impsInCurrentPeriod;
            if (periodStart != null) {
              const over = active - periodStart;
              if (over >= periodMs) {
                periodStart += Math.floor(over / periodMs) * periodMs;
                periodImps = 0;
              }
            } else {
              periodStart = active;
              periodImps = 0;
            }

            return {
              ...c,
              skills: { ...c.skills, [skill]: (c.skills[skill] ?? 0) + 1 },
              totalImps: c.totalImps + 1,
              periodStartActiveMs: periodStart,
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
          })
        );
      }
    },
    [periodLengthMinutes]
  );

  // --- Computed helpers ---
  const getElapsedMs = useCallback(
    (counter: ImproveCounter): number => {
      void tick;
      return activeElapsed(counter, Date.now());
    },
    [tick]
  );

  const getPerMinuteRate = useCallback(
    (counter: ImproveCounter): number => {
      const elapsed = getElapsedMs(counter);
      if (elapsed <= 0) return 0;
      return counter.totalImps / (elapsed / 60_000);
    },
    [getElapsedMs]
  );

  const getPerPeriodRate = useCallback(
    (counter: ImproveCounter): number => {
      const elapsed = getElapsedMs(counter);
      if (elapsed <= 0) return 0;
      return counter.totalImps / (elapsed / (periodLengthMinutes * 60_000));
    },
    [getElapsedMs, periodLengthMinutes]
  );

  const getPerHourRate = useCallback(
    (counter: ImproveCounter): number => {
      const elapsed = getElapsedMs(counter);
      if (elapsed <= 0) return 0;
      return counter.totalImps / (elapsed / 3_600_000);
    },
    [getElapsedMs]
  );

  const getPeriodProgress = useCallback(
    (counter: ImproveCounter): PeriodProgress => {
      void tick;
      const periodMs = periodLengthMinutes * 60_000;
      // No live window when stopped (or never started). Paused counters keep a
      // live window so the readout stays visible and frozen.
      if (counter.status === 'stopped' || counter.periodStartActiveMs == null) {
        return {
          imps: counter.impsInCurrentPeriod,
          elapsedMs: 0,
          periodMs,
          remainingMs: periodMs,
          active: false,
        };
      }
      const elapsedMs = Math.min(
        Math.max(0, activeElapsed(counter, Date.now()) - counter.periodStartActiveMs),
        periodMs
      );
      return {
        imps: counter.impsInCurrentPeriod,
        elapsedMs,
        periodMs,
        remainingMs: periodMs - elapsedMs,
        active: true,
      };
    },
    [tick, periodLengthMinutes]
  );

  const getSkillsSorted = useCallback((counter: ImproveCounter): SkillTally[] => {
    return Object.entries(counter.skills)
      .map(([skill, count]) => ({ skill, count }))
      .sort((a, b) => b.count - a.count);
  }, []);

  const getSkillPeriodRate = useCallback(
    (counter: ImproveCounter, skill: string): number => {
      const elapsed = getElapsedMs(counter);
      if (elapsed <= 0) return 0;
      const count = counter.skills[skill] ?? 0;
      return count / (elapsed / (periodLengthMinutes * 60_000));
    },
    [getElapsedMs, periodLengthMinutes]
  );

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
    archiveCounter,
    unarchiveCounter,
    reorderCounters,
    handleCounterMatch,
    setPeriodLength,
    getElapsedMs,
    getPerMinuteRate,
    getPerPeriodRate,
    getPerHourRate,
    getPeriodProgress,
    getSkillsSorted,
    getSkillPeriodRate,
  };
}
