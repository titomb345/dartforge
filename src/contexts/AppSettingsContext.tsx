import { createContext, useContext } from 'react';
import type { ChatFilters } from '../types/chat';
import type { TimestampFormat } from '../hooks/useAppSettings';

export interface AppSettingsState {
  // Anti-idle
  antiIdleEnabled: boolean;
  antiIdleCommand: string;
  antiIdleMinutes: number;
  updateAntiIdleEnabled: (v: boolean) => void;
  updateAntiIdleCommand: (v: string) => void;
  updateAntiIdleMinutes: (v: number) => void;
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
}

const AppSettingsContext = createContext<AppSettingsState | null>(null);

export const AppSettingsProvider = AppSettingsContext.Provider;

export function useAppSettingsContext(): AppSettingsState {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error('useAppSettingsContext must be used within an AppSettingsProvider');
  return ctx;
}
