import { useState, useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import type { ChatFilters } from '../types/chat';

const SETTINGS_FILE = 'settings.json';

export const DEFAULT_NUMPAD_MAPPINGS: Record<string, string> = {
  Numpad7: 'nw', Numpad8: 'n', Numpad9: 'ne',
  Numpad4: 'w', Numpad5: 'd', Numpad6: 'e',
  Numpad1: 'sw', Numpad2: 's', Numpad3: 'se',
  Numpad0: 'u', NumpadAdd: 'back',
};

const DEFAULT_NOTIFICATIONS: ChatFilters = {
  say: false, shout: false, ooc: false, tell: true, sz: true,
};

export type TimestampFormat = '12h' | '24h';

export function useAppSettings() {
  const dataStore = useDataStore();
  const loaded = useRef(false);

  /* ── Existing settings (moved from App.tsx) ────────────── */

  // Anti-idle
  const [antiIdleEnabled, setAntiIdleEnabled] = useState(false);
  const [antiIdleCommand, setAntiIdleCommand] = useState('hp');
  const [antiIdleMinutes, setAntiIdleMinutes] = useState(10);

  // Output transforms
  const [boardDatesEnabled, setBoardDatesEnabled] = useState(true);
  const [stripPromptsEnabled, setStripPromptsEnabled] = useState(true);

  /* ── New settings ──────────────────────────────────────── */

  // Buffer sizes
  const [terminalScrollback, setTerminalScrollback] = useState(10000);
  const [commandHistorySize, setCommandHistorySize] = useState(500);
  const [chatHistorySize, setChatHistorySize] = useState(500);

  // Chat timestamp format
  const [timestampFormat, setTimestampFormat] = useState<TimestampFormat>('12h');

  // Command echo
  const [commandEchoEnabled, setCommandEchoEnabled] = useState(false);

  // Session logging
  const [sessionLoggingEnabled, setSessionLoggingEnabled] = useState(false);

  // Numpad mappings
  const [numpadMappings, setNumpadMappings] = useState<Record<string, string>>({ ...DEFAULT_NUMPAD_MAPPINGS });

  // Auto-backup
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);

  // Desktop notifications per chat type
  const [chatNotifications, setChatNotifications] = useState<ChatFilters>({ ...DEFAULT_NOTIFICATIONS });

  // Custom chime sounds (original filename for display, null = default)
  const [customChime1, setCustomChime1] = useState<string | null>(null);
  const [customChime2, setCustomChime2] = useState<string | null>(null);

  // Load from settings
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      // Existing settings
      const savedAntiIdleEnabled = await dataStore.get<boolean>(SETTINGS_FILE, 'antiIdleEnabled');
      if (savedAntiIdleEnabled != null) setAntiIdleEnabled(savedAntiIdleEnabled);
      const savedAntiIdleCommand = await dataStore.get<string>(SETTINGS_FILE, 'antiIdleCommand');
      if (savedAntiIdleCommand != null) setAntiIdleCommand(savedAntiIdleCommand);
      const savedAntiIdleMinutes = await dataStore.get<number>(SETTINGS_FILE, 'antiIdleMinutes');
      if (savedAntiIdleMinutes != null) setAntiIdleMinutes(savedAntiIdleMinutes);
      const savedBoardDates = await dataStore.get<boolean>(SETTINGS_FILE, 'boardDatesEnabled');
      if (savedBoardDates != null) setBoardDatesEnabled(savedBoardDates);
      const savedStripPrompts = await dataStore.get<boolean>(SETTINGS_FILE, 'stripPromptsEnabled');
      if (savedStripPrompts != null) setStripPromptsEnabled(savedStripPrompts);

      // New settings
      const savedScrollback = await dataStore.get<number>(SETTINGS_FILE, 'terminalScrollback');
      if (savedScrollback != null && savedScrollback >= 1000) setTerminalScrollback(savedScrollback);
      const savedHistorySize = await dataStore.get<number>(SETTINGS_FILE, 'commandHistorySize');
      if (savedHistorySize != null && savedHistorySize >= 50) setCommandHistorySize(savedHistorySize);
      const savedChatHistorySize = await dataStore.get<number>(SETTINGS_FILE, 'chatHistorySize');
      if (savedChatHistorySize != null && savedChatHistorySize >= 50) setChatHistorySize(savedChatHistorySize);
      const savedTsFormat = await dataStore.get<TimestampFormat>(SETTINGS_FILE, 'timestampFormat');
      if (savedTsFormat === '12h' || savedTsFormat === '24h') setTimestampFormat(savedTsFormat);
      const savedEcho = await dataStore.get<boolean>(SETTINGS_FILE, 'commandEchoEnabled');
      if (savedEcho != null) setCommandEchoEnabled(savedEcho);
      const savedLogging = await dataStore.get<boolean>(SETTINGS_FILE, 'sessionLoggingEnabled');
      if (savedLogging != null) setSessionLoggingEnabled(savedLogging);
      const savedNumpad = await dataStore.get<Record<string, string>>(SETTINGS_FILE, 'numpadMappings');
      if (savedNumpad != null && typeof savedNumpad === 'object' && !Array.isArray(savedNumpad)) {
        setNumpadMappings(savedNumpad);
      }
      const savedAutoBackup = await dataStore.get<boolean>(SETTINGS_FILE, 'autoBackupEnabled');
      if (savedAutoBackup != null) setAutoBackupEnabled(savedAutoBackup);
      const savedNotifications = await dataStore.get<ChatFilters>(SETTINGS_FILE, 'chatNotifications');
      if (savedNotifications != null && typeof savedNotifications === 'object' && !Array.isArray(savedNotifications)) {
        setChatNotifications(savedNotifications);
      }
      const savedCustomChime1 = await dataStore.get<string | null>(SETTINGS_FILE, 'customChime1');
      if (savedCustomChime1 !== undefined) setCustomChime1(savedCustomChime1);
      const savedCustomChime2 = await dataStore.get<string | null>(SETTINGS_FILE, 'customChime2');
      if (savedCustomChime2 !== undefined) setCustomChime2(savedCustomChime2);

      loaded.current = true;
    })().catch(console.error);
  }, [dataStore.ready]);

  // Persist helper
  const persist = useCallback((key: string, value: unknown) => {
    if (!loaded.current) return;
    dataStore.set(SETTINGS_FILE, key, value).catch(console.error);
  }, [dataStore]);

  /* ── Change handlers (existing settings) ───────────────── */

  const updateAntiIdleEnabled = useCallback((v: boolean) => {
    setAntiIdleEnabled(v);
    persist('antiIdleEnabled', v);
  }, [persist]);

  const updateAntiIdleCommand = useCallback((v: string) => {
    setAntiIdleCommand(v);
    persist('antiIdleCommand', v);
  }, [persist]);

  const updateAntiIdleMinutes = useCallback((v: number) => {
    setAntiIdleMinutes(v);
    persist('antiIdleMinutes', v);
  }, [persist]);

  const updateBoardDatesEnabled = useCallback((v: boolean) => {
    setBoardDatesEnabled(v);
    persist('boardDatesEnabled', v);
  }, [persist]);

  const updateStripPromptsEnabled = useCallback((v: boolean) => {
    setStripPromptsEnabled(v);
    persist('stripPromptsEnabled', v);
  }, [persist]);

  /* ── Change handlers (new settings) ────────────────────── */

  const updateTerminalScrollback = useCallback((v: number) => {
    setTerminalScrollback(v);
    persist('terminalScrollback', v);
  }, [persist]);

  const updateCommandHistorySize = useCallback((v: number) => {
    setCommandHistorySize(v);
    persist('commandHistorySize', v);
  }, [persist]);

  const updateChatHistorySize = useCallback((v: number) => {
    setChatHistorySize(v);
    persist('chatHistorySize', v);
  }, [persist]);

  const updateTimestampFormat = useCallback((v: TimestampFormat) => {
    setTimestampFormat(v);
    persist('timestampFormat', v);
  }, [persist]);

  const updateCommandEchoEnabled = useCallback((v: boolean) => {
    setCommandEchoEnabled(v);
    persist('commandEchoEnabled', v);
  }, [persist]);

  const updateSessionLoggingEnabled = useCallback((v: boolean) => {
    setSessionLoggingEnabled(v);
    persist('sessionLoggingEnabled', v);
  }, [persist]);

  const updateNumpadMappings = useCallback((v: Record<string, string>) => {
    setNumpadMappings(v);
    persist('numpadMappings', v);
  }, [persist]);

  const updateAutoBackupEnabled = useCallback((v: boolean) => {
    setAutoBackupEnabled(v);
    persist('autoBackupEnabled', v);
  }, [persist]);

  const updateChatNotifications = useCallback((v: ChatFilters) => {
    setChatNotifications(v);
    persist('chatNotifications', v);
  }, [persist]);

  const updateCustomChime1 = useCallback((v: string | null) => {
    setCustomChime1(v);
    persist('customChime1', v);
  }, [persist]);

  const updateCustomChime2 = useCallback((v: string | null) => {
    setCustomChime2(v);
    persist('customChime2', v);
  }, [persist]);

  const toggleChatNotification = useCallback(async (type: keyof ChatFilters) => {
    // Request permission when enabling a notification for the first time
    const current = chatNotifications[type];
    if (!current && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') return; // user denied, don't enable
    }
    setChatNotifications((prev) => {
      const next = { ...prev, [type]: !prev[type] };
      persist('chatNotifications', next);
      return next;
    });
  }, [persist, chatNotifications]);

  return {
    // Anti-idle
    antiIdleEnabled, antiIdleCommand, antiIdleMinutes,
    updateAntiIdleEnabled, updateAntiIdleCommand, updateAntiIdleMinutes,
    // Output transforms
    boardDatesEnabled, stripPromptsEnabled,
    updateBoardDatesEnabled, updateStripPromptsEnabled,
    // Buffer sizes
    terminalScrollback, commandHistorySize, chatHistorySize,
    updateTerminalScrollback, updateCommandHistorySize, updateChatHistorySize,
    // Timestamp
    timestampFormat, updateTimestampFormat,
    // Command echo
    commandEchoEnabled, updateCommandEchoEnabled,
    // Session logging
    sessionLoggingEnabled, updateSessionLoggingEnabled,
    // Numpad
    numpadMappings, updateNumpadMappings,
    // Backups
    autoBackupEnabled, updateAutoBackupEnabled,
    // Notifications
    chatNotifications, updateChatNotifications, toggleChatNotification,
    // Custom chimes
    customChime1, customChime2, updateCustomChime1, updateCustomChime2,
  };
}
