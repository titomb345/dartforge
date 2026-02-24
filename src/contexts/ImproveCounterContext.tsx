import { createContext, useContext } from 'react';
import type { ImproveCounter } from '../types/counter';
import type { SkillMatchResult } from '../types/skills';
import type { SkillTally } from '../hooks/useImproveCounters';

export interface ImproveCounterState {
  counters: ImproveCounter[];
  activeCounterId: string | null;
  periodLengthMinutes: number;
  setActiveCounterId: (id: string | null) => void;
  createCounter: (name: string) => string;
  deleteCounter: (id: string) => void;
  renameCounter: (id: string, name: string) => void;
  startCounter: (id: string) => void;
  pauseCounter: (id: string) => void;
  resumeCounter: (id: string) => void;
  stopCounter: (id: string) => void;
  clearCounter: (id: string) => void;
  handleCounterMatch: (match: SkillMatchResult) => void;
  setPeriodLength: (minutes: number) => void;
  getElapsedMs: (counter: ImproveCounter) => number;
  getPerMinuteRate: (counter: ImproveCounter) => number;
  getPerPeriodRate: (counter: ImproveCounter) => number;
  getPerHourRate: (counter: ImproveCounter) => number;
  getSkillsSorted: (counter: ImproveCounter) => SkillTally[];
  getSkillPeriodRate: (counter: ImproveCounter, skill: string) => number;
}

const ImproveCounterContext = createContext<ImproveCounterState | null>(null);

export const ImproveCounterProvider = ImproveCounterContext.Provider;

export function useImproveCounterContext(): ImproveCounterState {
  const ctx = useContext(ImproveCounterContext);
  if (!ctx)
    throw new Error('useImproveCounterContext must be used within an ImproveCounterProvider');
  return ctx;
}
