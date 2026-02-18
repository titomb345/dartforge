export type CounterStatus = 'stopped' | 'running' | 'paused';

export interface ImproveCounter {
  id: string;
  name: string;
  status: CounterStatus;
  skills: Record<string, number>;
  totalImps: number;

  /** ISO timestamp when counter was first started */
  startedAt: string | null;
  /** Total accumulated elapsed ms (excludes paused time) */
  accumulatedMs: number;
  /** ISO timestamp of last save/pause — used for resume calculation */
  lastTickAt: string | null;

  /** ISO timestamp when current period began */
  periodStartAt: string | null;
  /** Imps counted since periodStartAt */
  impsInCurrentPeriod: number;
}

export interface CounterStore {
  counters: ImproveCounter[];
  activeCounterId: string | null;
  periodLengthMinutes: number;
}
