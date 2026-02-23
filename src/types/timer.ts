/** Unique timer identifier */
export type TimerId = string;

/** Timer scope — character-specific or shared across all characters */
export type TimerScope = 'character' | 'global';

/** An individual timer definition */
export interface Timer {
  id: TimerId;
  /** Display name for this timer */
  name: string;
  /** The command body to execute. Supports $me, $Me, ;, /delay, /echo, /spam, /var, etc. */
  body: string;
  /** Interval in seconds between firings */
  intervalSeconds: number;
  /** Whether this timer is active */
  enabled: boolean;
  /** User-assigned group for organization */
  group: string;
  /** When this timer was created (ISO string) */
  createdAt: string;
  /** When this timer was last modified (ISO string) */
  updatedAt: string;
}
