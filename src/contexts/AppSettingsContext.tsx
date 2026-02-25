import { createContext, useContext } from 'react';
import type { ChatFilters } from '../types/chat';
import type { TimestampFormat, CharacterProfile } from '../hooks/useAppSettings';
import type { GagGroupSettings } from '../lib/gagPatterns';

export interface AppSettingsState {
  // Anti-idle
  antiIdleEnabled: boolean;
  antiIdleCommand: string;
  antiIdleMinutes: number;
  updateAntiIdleEnabled: (v: boolean) => void;
  updateAntiIdleCommand: (v: string) => void;
  updateAntiIdleMinutes: (v: number) => void;
  // Alignment tracking
  alignmentTrackingEnabled: boolean;
  alignmentTrackingMinutes: number;
  updateAlignmentTrackingEnabled: (v: boolean) => void;
  updateAlignmentTrackingMinutes: (v: number) => void;
  // Output transforms
  boardDatesEnabled: boolean;
  stripPromptsEnabled: boolean;
  updateBoardDatesEnabled: (v: boolean) => void;
  updateStripPromptsEnabled: (v: boolean) => void;
  // Buffer sizes
  terminalScrollback: number;
  commandHistorySize: number;
  chatHistorySize: number;
  updateTerminalScrollback: (v: number) => void;
  updateCommandHistorySize: (v: number) => void;
  updateChatHistorySize: (v: number) => void;
  // Timestamp
  timestampFormat: TimestampFormat;
  updateTimestampFormat: (v: TimestampFormat) => void;
  // Command echo
  commandEchoEnabled: boolean;
  updateCommandEchoEnabled: (v: boolean) => void;
  // Timer badges
  showTimerBadges: boolean;
  updateShowTimerBadges: (v: boolean) => void;
  // Session logging
  sessionLoggingEnabled: boolean;
  updateSessionLoggingEnabled: (v: boolean) => void;
  // Numpad
  numpadMappings: Record<string, string>;
  updateNumpadMappings: (v: Record<string, string>) => void;
  // Backups
  autoBackupEnabled: boolean;
  updateAutoBackupEnabled: (v: boolean) => void;
  // Notifications
  chatNotifications: ChatFilters;
  updateChatNotifications: (v: ChatFilters) => void;
  toggleChatNotification: (type: keyof ChatFilters) => void;
  // Custom chimes
  customChime1: string | null;
  customChime2: string | null;
  updateCustomChime1: (v: string | null) => void;
  updateCustomChime2: (v: string | null) => void;
  // Counter thresholds
  counterHotThreshold: number;
  counterColdThreshold: number;
  updateCounterHotThreshold: (v: number) => void;
  updateCounterColdThreshold: (v: number) => void;
  // Help guide
  hasSeenGuide: boolean;
  updateHasSeenGuide: (v: boolean) => void;
  // Action blocking
  actionBlockingEnabled: boolean;
  updateActionBlockingEnabled: (v: boolean) => void;
  // Gag groups
  gagGroups: GagGroupSettings;
  updateGagGroups: (v: GagGroupSettings) => void;
  // Babel language trainer
  babelEnabled: boolean;
  babelLanguage: string;
  babelIntervalSeconds: number;
  babelPhrases: string[];
  updateBabelEnabled: (v: boolean) => void;
  updateBabelLanguage: (v: string) => void;
  updateBabelIntervalSeconds: (v: number) => void;
  updateBabelPhrases: (v: string[]) => void;
  // Post-sync commands
  postSyncEnabled: boolean;
  postSyncCommands: string;
  updatePostSyncEnabled: (v: boolean) => void;
  updatePostSyncCommands: (v: string) => void;
  // Who list
  whoAutoRefreshEnabled: boolean;
  whoRefreshMinutes: number;
  whoFontSize: number;
  updateWhoAutoRefreshEnabled: (v: boolean) => void;
  updateWhoRefreshMinutes: (v: number) => void;
  updateWhoFontSize: (v: number) => void;
  // Chat font size
  chatFontSize: number;
  updateChatFontSize: (v: number) => void;
  // Auto-login
  autoLoginEnabled: boolean;
  autoLoginActiveSlot: 0 | 1;
  autoLoginCharacters: [CharacterProfile | null, CharacterProfile | null];
  lastLoginTimestamp: number | null;
  lastLoginSlot: 0 | 1 | null;
  updateAutoLoginEnabled: (v: boolean) => void;
  updateAutoLoginActiveSlot: (v: 0 | 1) => void;
  updateAutoLoginCharacters: (v: [CharacterProfile | null, CharacterProfile | null]) => void;
  updateLastLoginTimestamp: (v: number | null) => void;
  updateLastLoginSlot: (v: 0 | 1 | null) => void;
  // Character switching (provided by App.tsx)
  onSwitchCharacter?: () => void;
  connected?: boolean;
}

const AppSettingsContext = createContext<AppSettingsState | null>(null);

export const AppSettingsProvider = AppSettingsContext.Provider;

export function useAppSettingsContext(): AppSettingsState {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error('useAppSettingsContext must be used within an AppSettingsProvider');
  return ctx;
}
