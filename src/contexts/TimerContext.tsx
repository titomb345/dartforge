import { createContext, useContext } from 'react';
import type { Timer, TimerId, TimerScope } from '../types/timer';

export interface TimerState {
  characterTimers: Record<TimerId, Timer>;
  globalTimers: Record<TimerId, Timer>;
  mergedTimers: Timer[];
  createTimer: (
    partial: {
      name: string;
      body: string;
      intervalSeconds: number;
      group: string;
    },
    scope: TimerScope,
  ) => TimerId;
  updateTimer: (
    id: TimerId,
    updates: Partial<Omit<Timer, 'id' | 'createdAt'>>,
    scope: TimerScope,
  ) => void;
  deleteTimer: (id: TimerId, scope: TimerScope) => void;
  toggleTimer: (id: TimerId, scope: TimerScope) => void;
  duplicateTimer: (id: TimerId, scope: TimerScope) => TimerId | null;
}

const TimerContext = createContext<TimerState | null>(null);

export const TimerProvider = TimerContext.Provider;

export function useTimerContext(): TimerState {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimerContext must be used within a TimerProvider');
  return ctx;
}
