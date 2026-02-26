import { createContext, useContext } from 'react';
import type { ActiveTimerBadge } from '../hooks/useTimerEngines';
import type { MovementMode } from '../lib/movementMode';

export interface CommandInputState {
  // Connection
  connected: boolean;
  disabled: boolean;
  passwordMode: boolean;
  skipHistory: boolean;
  // Refs
  recentLinesRef: React.RefObject<string[]>;
  // Counter
  onToggleCounter?: () => void;
  // Anti-idle
  antiIdleEnabled: boolean;
  antiIdleCommand: string;
  antiIdleMinutes: number;
  antiIdleNextAt: number | null;
  onToggleAntiIdle: () => void;
  // Alignment
  alignmentTrackingEnabled: boolean;
  alignmentTrackingMinutes: number;
  alignmentNextAt: number | null;
  onToggleAlignmentTracking: () => void;
  // Who auto-refresh
  whoAutoRefreshEnabled: boolean;
  whoRefreshMinutes: number;
  whoNextAt: number | null;
  onToggleWhoAutoRefresh: () => void;
  // Action blocking
  actionBlocked: boolean;
  actionBlockLabel: string | null;
  actionQueueLength: number;
  // Movement mode
  movementMode: MovementMode;
  onToggleMovementMode: () => void;
  // Babel
  babelEnabled: boolean;
  babelLanguage: string;
  babelNextAt: number | null;
  onToggleBabel: () => void;
  // Auto-inscriber
  inscriberActive: boolean;
  inscriberSpell: string | null;
  inscriberCycleCount: number;
  onStopInscriber: () => void;
  // Custom timers
  activeTimers: ActiveTimerBadge[];
  onToggleTimer: (id: string) => void;
  // History
  initialHistory: string[];
  onHistoryChange: (history: string[]) => void;
}

const CommandInputContext = createContext<CommandInputState | null>(null);

export const CommandInputProvider = CommandInputContext.Provider;

export function useCommandInputContext(): CommandInputState {
  const ctx = useContext(CommandInputContext);
  if (!ctx) throw new Error('useCommandInputContext must be used within a CommandInputProvider');
  return ctx;
}
