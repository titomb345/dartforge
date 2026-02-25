import { useState, useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import { getPlatform } from '../lib/platform';
import type { ChatFilters } from '../types/chat';
import { DEFAULT_GAG_GROUPS, type GagGroupSettings } from '../lib/gagPatterns';

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
if (getPlatform() === 'tauri') {
  import('@tauri-apps/api/core').then((m) => {
    invoke = m.invoke;
  });
}

const SETTINGS_FILE = 'settings.json';

export const DEFAULT_NUMPAD_MAPPINGS: Record<string, string> = {
  Numpad7: 'nw',
  Numpad8: 'n',
  Numpad9: 'ne',
  Numpad4: 'w',
  Numpad5: 'd',
  Numpad6: 'e',
  Numpad1: 'sw',
  Numpad2: 's',
  Numpad3: 'se',
  Numpad0: 'u',
  NumpadAdd: 'back',
};

const DEFAULT_NOTIFICATIONS: ChatFilters = {
  say: false,
  shout: false,
  ooc: false,
  tell: false,
  sz: false,
};

export type TimestampFormat = '12h' | '24h';

export interface CharacterProfile {
  name: string;
  password: string;
}

export function useAppSettings() {
  const dataStore = useDataStore();
  const loaded = useRef(false);

  /* ── Existing settings (moved from App.tsx) ────────────── */

  // Anti-idle
  const [antiIdleEnabled, setAntiIdleEnabled] = useState(false);
  const [antiIdleCommand, setAntiIdleCommand] = useState('hp');
  const [antiIdleMinutes, setAntiIdleMinutes] = useState(10);

  // Alignment tracking
  const [alignmentTrackingEnabled, setAlignmentTrackingEnabled] = useState(false);
  const [alignmentTrackingMinutes, setAlignmentTrackingMinutes] = useState(5);

  // Output transforms
  const [boardDatesEnabled, setBoardDatesEnabled] = useState(false);
  const [stripPromptsEnabled, setStripPromptsEnabled] = useState(false);

  /* ── New settings ──────────────────────────────────────── */

  // Buffer sizes
  const [terminalScrollback, setTerminalScrollback] = useState(10000);
  const [commandHistorySize, setCommandHistorySize] = useState(500);
  const [chatHistorySize, setChatHistorySize] = useState(500);

  // Chat timestamp format
  const [timestampFormat, setTimestampFormat] = useState<TimestampFormat>('12h');

  // Command echo
  const [commandEchoEnabled, setCommandEchoEnabled] = useState(false);

  // Timer badge display
  const [showTimerBadges, setShowTimerBadges] = useState(true);

  // Session logging
  const [sessionLoggingEnabled, setSessionLoggingEnabled] = useState(false);

  // Numpad mappings
  const [numpadMappings, setNumpadMappings] = useState<Record<string, string>>({
    ...DEFAULT_NUMPAD_MAPPINGS,
  });

  // Auto-backup
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);

  // Desktop notifications per chat type
  const [chatNotifications, setChatNotifications] = useState<ChatFilters>({
    ...DEFAULT_NOTIFICATIONS,
  });

  // Custom chime sounds (original filename for display, null = default)
  const [customChime1, setCustomChime1] = useState<string | null>(null);
  const [customChime2, setCustomChime2] = useState<string | null>(null);

  // Counter thresholds
  const [counterHotThreshold, setCounterHotThreshold] = useState(5.0);
  const [counterColdThreshold, setCounterColdThreshold] = useState(1.0);

  // Help guide
  const [hasSeenGuide, setHasSeenGuide] = useState(false);

  // Action blocking
  const [actionBlockingEnabled, setActionBlockingEnabled] = useState(true);

  // Who list auto-refresh
  const [whoAutoRefreshEnabled, setWhoAutoRefreshEnabled] = useState(true);
  const [whoRefreshMinutes, setWhoRefreshMinutes] = useState(5);

  // Babel language trainer
  const [babelEnabled, setBabelEnabled] = useState(false);
  const [babelLanguage, setBabelLanguage] = useState('');
  const [babelIntervalSeconds, setBabelIntervalSeconds] = useState(30);
  const [babelPhrases, setBabelPhrases] = useState<string[]>([]);

  // Gag groups
  const [gagGroups, setGagGroups] = useState<GagGroupSettings>({ ...DEFAULT_GAG_GROUPS });

  // Post-sync commands
  const [postSyncEnabled, setPostSyncEnabled] = useState(false);
  const [postSyncCommands, setPostSyncCommands] = useState('');

  // Auto-login (names stored in settings.json, passwords in OS keyring)
  const [autoLoginEnabled, setAutoLoginEnabled] = useState(false);
  const [autoLoginActiveSlot, setAutoLoginActiveSlot] = useState<0 | 1>(0);
  const [autoLoginCharacters, setAutoLoginCharacters] = useState<
    [CharacterProfile | null, CharacterProfile | null]
  >([null, null]);
  const [lastLoginTimestamp, setLastLoginTimestamp] = useState<number | null>(null);
  const [lastLoginSlot, setLastLoginSlot] = useState<0 | 1 | null>(null);

  // Keyring helpers — store/retrieve passwords via OS credential manager
  const storePassword = useCallback(async (slot: 0 | 1, password: string) => {
    if (!invoke) return;
    try {
      await invoke('store_credential', { account: `dartmud-slot-${slot}`, password });
    } catch (e) {
      console.error('Failed to store credential:', e);
    }
  }, []);

  const deletePassword = useCallback(async (slot: 0 | 1) => {
    if (!invoke) return;
    try {
      await invoke('delete_credential', { account: `dartmud-slot-${slot}` });
    } catch (e) {
      console.error('Failed to delete credential:', e);
    }
  }, []);

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
      const savedAlignmentEnabled = await dataStore.get<boolean>(
        SETTINGS_FILE,
        'alignmentTrackingEnabled'
      );
      if (savedAlignmentEnabled != null) setAlignmentTrackingEnabled(savedAlignmentEnabled);
      const savedAlignmentMinutes = await dataStore.get<number>(
        SETTINGS_FILE,
        'alignmentTrackingMinutes'
      );
      if (savedAlignmentMinutes != null) setAlignmentTrackingMinutes(savedAlignmentMinutes);
      const savedBoardDates = await dataStore.get<boolean>(SETTINGS_FILE, 'boardDatesEnabled');
      if (savedBoardDates != null) setBoardDatesEnabled(savedBoardDates);
      const savedStripPrompts = await dataStore.get<boolean>(SETTINGS_FILE, 'stripPromptsEnabled');
      if (savedStripPrompts != null) setStripPromptsEnabled(savedStripPrompts);

      // New settings
      const savedScrollback = await dataStore.get<number>(SETTINGS_FILE, 'terminalScrollback');
      if (savedScrollback != null && savedScrollback >= 1000)
        setTerminalScrollback(savedScrollback);
      const savedHistorySize = await dataStore.get<number>(SETTINGS_FILE, 'commandHistorySize');
      if (savedHistorySize != null && savedHistorySize >= 50)
        setCommandHistorySize(savedHistorySize);
      const savedChatHistorySize = await dataStore.get<number>(SETTINGS_FILE, 'chatHistorySize');
      if (savedChatHistorySize != null && savedChatHistorySize >= 50)
        setChatHistorySize(savedChatHistorySize);
      const savedTsFormat = await dataStore.get<TimestampFormat>(SETTINGS_FILE, 'timestampFormat');
      if (savedTsFormat === '12h' || savedTsFormat === '24h') setTimestampFormat(savedTsFormat);
      const savedEcho = await dataStore.get<boolean>(SETTINGS_FILE, 'commandEchoEnabled');
      if (savedEcho != null) setCommandEchoEnabled(savedEcho);
      const savedTimerBadges = await dataStore.get<boolean>(SETTINGS_FILE, 'showTimerBadges');
      if (savedTimerBadges != null) setShowTimerBadges(savedTimerBadges);
      const savedLogging = await dataStore.get<boolean>(SETTINGS_FILE, 'sessionLoggingEnabled');
      if (savedLogging != null) setSessionLoggingEnabled(savedLogging);
      const savedNumpad = await dataStore.get<Record<string, string>>(
        SETTINGS_FILE,
        'numpadMappings'
      );
      if (savedNumpad != null && typeof savedNumpad === 'object' && !Array.isArray(savedNumpad)) {
        setNumpadMappings(savedNumpad);
      }
      const savedAutoBackup = await dataStore.get<boolean>(SETTINGS_FILE, 'autoBackupEnabled');
      if (savedAutoBackup != null) setAutoBackupEnabled(savedAutoBackup);
      const savedNotifications = await dataStore.get<ChatFilters>(
        SETTINGS_FILE,
        'chatNotifications'
      );
      if (
        savedNotifications != null &&
        typeof savedNotifications === 'object' &&
        !Array.isArray(savedNotifications)
      ) {
        setChatNotifications(savedNotifications);
      }
      const savedCustomChime1 = await dataStore.get<string | null>(SETTINGS_FILE, 'customChime1');
      if (savedCustomChime1 !== undefined) setCustomChime1(savedCustomChime1);
      const savedCustomChime2 = await dataStore.get<string | null>(SETTINGS_FILE, 'customChime2');
      if (savedCustomChime2 !== undefined) setCustomChime2(savedCustomChime2);
      const savedHotThreshold = await dataStore.get<number>(SETTINGS_FILE, 'counterHotThreshold');
      if (savedHotThreshold != null && savedHotThreshold >= 0)
        setCounterHotThreshold(savedHotThreshold);
      const savedColdThreshold = await dataStore.get<number>(SETTINGS_FILE, 'counterColdThreshold');
      if (savedColdThreshold != null && savedColdThreshold >= 0)
        setCounterColdThreshold(savedColdThreshold);
      const savedHasSeenGuide = await dataStore.get<boolean>(SETTINGS_FILE, 'hasSeenGuide');
      if (savedHasSeenGuide != null) setHasSeenGuide(savedHasSeenGuide);
      const savedActionBlocking = await dataStore.get<boolean>(
        SETTINGS_FILE,
        'actionBlockingEnabled'
      );
      if (savedActionBlocking != null) setActionBlockingEnabled(savedActionBlocking);
      const savedWhoAutoRefresh = await dataStore.get<boolean>(
        SETTINGS_FILE,
        'whoAutoRefreshEnabled'
      );
      if (savedWhoAutoRefresh != null) setWhoAutoRefreshEnabled(savedWhoAutoRefresh);
      const savedWhoMinutes = await dataStore.get<number>(SETTINGS_FILE, 'whoRefreshMinutes');
      if (savedWhoMinutes != null && savedWhoMinutes >= 1) setWhoRefreshMinutes(savedWhoMinutes);

      const savedGagGroups = await dataStore.get<GagGroupSettings>(SETTINGS_FILE, 'gagGroups');
      if (savedGagGroups) setGagGroups(savedGagGroups);

      // Babel
      const savedBabelEnabled = await dataStore.get<boolean>(SETTINGS_FILE, 'babelEnabled');
      if (savedBabelEnabled != null) setBabelEnabled(savedBabelEnabled);
      const savedBabelLanguage = await dataStore.get<string>(SETTINGS_FILE, 'babelLanguage');
      if (savedBabelLanguage != null) setBabelLanguage(savedBabelLanguage);
      const savedBabelInterval = await dataStore.get<number>(SETTINGS_FILE, 'babelIntervalSeconds');
      if (savedBabelInterval != null && savedBabelInterval >= 10)
        setBabelIntervalSeconds(savedBabelInterval);
      const savedBabelPhrases = await dataStore.get<string[]>(SETTINGS_FILE, 'babelPhrases');
      if (Array.isArray(savedBabelPhrases) && savedBabelPhrases.length > 0)
        setBabelPhrases(savedBabelPhrases);

      const savedPostSyncEnabled = await dataStore.get<boolean>(SETTINGS_FILE, 'postSyncEnabled');
      if (savedPostSyncEnabled != null) setPostSyncEnabled(savedPostSyncEnabled);
      const savedPostSyncCommands = await dataStore.get<string>(SETTINGS_FILE, 'postSyncCommands');
      if (savedPostSyncCommands != null) setPostSyncCommands(savedPostSyncCommands);

      // Auto-login (names from settings, passwords from OS keyring)
      const savedAutoLoginEnabled = await dataStore.get<boolean>(SETTINGS_FILE, 'autoLoginEnabled');
      if (savedAutoLoginEnabled != null) setAutoLoginEnabled(savedAutoLoginEnabled);
      const savedAutoLoginActiveSlot = await dataStore.get<number>(
        SETTINGS_FILE,
        'autoLoginActiveSlot'
      );
      if (savedAutoLoginActiveSlot === 0 || savedAutoLoginActiveSlot === 1)
        setAutoLoginActiveSlot(savedAutoLoginActiveSlot);
      const savedNames = await dataStore.get<[string | null, string | null]>(
        SETTINGS_FILE,
        'autoLoginNames'
      );
      if (Array.isArray(savedNames) && savedNames.length === 2) {
        // Load passwords from keyring for each slot that has a name
        const profiles: [CharacterProfile | null, CharacterProfile | null] = [null, null];
        for (const slot of [0, 1] as const) {
          const name = savedNames[slot];
          if (name) {
            let pw: string | null = null;
            if (invoke) {
              try {
                pw = (await invoke('get_credential', { account: `dartmud-slot-${slot}` })) as
                  | string
                  | null;
              } catch {
                /* keyring unavailable */
              }
            }
            profiles[slot] = { name, password: pw ?? '' };
          }
        }
        setAutoLoginCharacters(profiles);
      }
      const savedLastLoginTimestamp = await dataStore.get<number | null>(
        SETTINGS_FILE,
        'lastLoginTimestamp'
      );
      if (savedLastLoginTimestamp !== undefined) setLastLoginTimestamp(savedLastLoginTimestamp);
      const savedLastLoginSlot = await dataStore.get<number | null>(SETTINGS_FILE, 'lastLoginSlot');
      if (savedLastLoginSlot === 0 || savedLastLoginSlot === 1 || savedLastLoginSlot === null) {
        setLastLoginSlot(savedLastLoginSlot as 0 | 1 | null);
      }

      loaded.current = true;
    })().catch(console.error);
  }, [dataStore.ready]);

  // Persist helper
  const persist = useCallback(
    (key: string, value: unknown) => {
      if (!loaded.current) return;
      dataStore.set(SETTINGS_FILE, key, value).catch(console.error);
    },
    [dataStore]
  );

  /* ── Change handlers (existing settings) ───────────────── */

  const updateAntiIdleEnabled = useCallback(
    (v: boolean) => {
      setAntiIdleEnabled(v);
      persist('antiIdleEnabled', v);
    },
    [persist]
  );

  const updateAntiIdleCommand = useCallback(
    (v: string) => {
      setAntiIdleCommand(v);
      persist('antiIdleCommand', v);
    },
    [persist]
  );

  const updateAntiIdleMinutes = useCallback(
    (v: number) => {
      setAntiIdleMinutes(v);
      persist('antiIdleMinutes', v);
    },
    [persist]
  );

  const updateAlignmentTrackingEnabled = useCallback(
    (v: boolean) => {
      setAlignmentTrackingEnabled(v);
      persist('alignmentTrackingEnabled', v);
      // Alignment polling replaces anti-idle — force it off when enabling
      if (v) {
        setAntiIdleEnabled(false);
        persist('antiIdleEnabled', false);
      }
    },
    [persist]
  );

  const updateAlignmentTrackingMinutes = useCallback(
    (v: number) => {
      setAlignmentTrackingMinutes(v);
      persist('alignmentTrackingMinutes', v);
    },
    [persist]
  );

  const updateBoardDatesEnabled = useCallback(
    (v: boolean) => {
      setBoardDatesEnabled(v);
      persist('boardDatesEnabled', v);
    },
    [persist]
  );

  const updateStripPromptsEnabled = useCallback(
    (v: boolean) => {
      setStripPromptsEnabled(v);
      persist('stripPromptsEnabled', v);
    },
    [persist]
  );

  /* ── Change handlers (new settings) ────────────────────── */

  const updateTerminalScrollback = useCallback(
    (v: number) => {
      setTerminalScrollback(v);
      persist('terminalScrollback', v);
    },
    [persist]
  );

  const updateCommandHistorySize = useCallback(
    (v: number) => {
      setCommandHistorySize(v);
      persist('commandHistorySize', v);
    },
    [persist]
  );

  const updateChatHistorySize = useCallback(
    (v: number) => {
      setChatHistorySize(v);
      persist('chatHistorySize', v);
    },
    [persist]
  );

  const updateTimestampFormat = useCallback(
    (v: TimestampFormat) => {
      setTimestampFormat(v);
      persist('timestampFormat', v);
    },
    [persist]
  );

  const updateCommandEchoEnabled = useCallback(
    (v: boolean) => {
      setCommandEchoEnabled(v);
      persist('commandEchoEnabled', v);
    },
    [persist]
  );

  const updateShowTimerBadges = useCallback(
    (v: boolean) => {
      setShowTimerBadges(v);
      persist('showTimerBadges', v);
    },
    [persist]
  );

  const updateSessionLoggingEnabled = useCallback(
    (v: boolean) => {
      setSessionLoggingEnabled(v);
      persist('sessionLoggingEnabled', v);
    },
    [persist]
  );

  const updateNumpadMappings = useCallback(
    (v: Record<string, string>) => {
      setNumpadMappings(v);
      persist('numpadMappings', v);
    },
    [persist]
  );

  const updateAutoBackupEnabled = useCallback(
    (v: boolean) => {
      setAutoBackupEnabled(v);
      persist('autoBackupEnabled', v);
    },
    [persist]
  );

  const updateChatNotifications = useCallback(
    (v: ChatFilters) => {
      setChatNotifications(v);
      persist('chatNotifications', v);
    },
    [persist]
  );

  const updateCustomChime1 = useCallback(
    (v: string | null) => {
      setCustomChime1(v);
      persist('customChime1', v);
    },
    [persist]
  );

  const updateCustomChime2 = useCallback(
    (v: string | null) => {
      setCustomChime2(v);
      persist('customChime2', v);
    },
    [persist]
  );

  const updateCounterHotThreshold = useCallback(
    (v: number) => {
      setCounterHotThreshold(v);
      persist('counterHotThreshold', v);
    },
    [persist]
  );

  const updateCounterColdThreshold = useCallback(
    (v: number) => {
      setCounterColdThreshold(v);
      persist('counterColdThreshold', v);
    },
    [persist]
  );

  const updateHasSeenGuide = useCallback(
    (v: boolean) => {
      setHasSeenGuide(v);
      persist('hasSeenGuide', v);
    },
    [persist]
  );

  const updateActionBlockingEnabled = useCallback(
    (v: boolean) => {
      setActionBlockingEnabled(v);
      persist('actionBlockingEnabled', v);
    },
    [persist]
  );

  const updateWhoAutoRefreshEnabled = useCallback(
    (v: boolean) => {
      setWhoAutoRefreshEnabled(v);
      persist('whoAutoRefreshEnabled', v);
    },
    [persist]
  );

  const updateWhoRefreshMinutes = useCallback(
    (v: number) => {
      setWhoRefreshMinutes(v);
      persist('whoRefreshMinutes', v);
    },
    [persist]
  );

  const updateGagGroups = useCallback(
    (v: GagGroupSettings) => {
      setGagGroups(v);
      persist('gagGroups', v);
    },
    [persist]
  );

  // Babel
  const updateBabelEnabled = useCallback(
    (v: boolean) => {
      setBabelEnabled(v);
      persist('babelEnabled', v);
    },
    [persist]
  );

  const updateBabelLanguage = useCallback(
    (v: string) => {
      setBabelLanguage(v);
      persist('babelLanguage', v);
    },
    [persist]
  );

  const updateBabelIntervalSeconds = useCallback(
    (v: number) => {
      setBabelIntervalSeconds(v);
      persist('babelIntervalSeconds', v);
    },
    [persist]
  );

  const updateBabelPhrases = useCallback(
    (v: string[]) => {
      setBabelPhrases(v);
      persist('babelPhrases', v);
    },
    [persist]
  );

  const updatePostSyncEnabled = useCallback(
    (v: boolean) => {
      setPostSyncEnabled(v);
      persist('postSyncEnabled', v);
    },
    [persist]
  );

  const updatePostSyncCommands = useCallback(
    (v: string) => {
      setPostSyncCommands(v);
      persist('postSyncCommands', v);
    },
    [persist]
  );

  const updateAutoLoginEnabled = useCallback(
    (v: boolean) => {
      setAutoLoginEnabled(v);
      persist('autoLoginEnabled', v);
    },
    [persist]
  );

  const updateAutoLoginActiveSlot = useCallback(
    (v: 0 | 1) => {
      setAutoLoginActiveSlot(v);
      persist('autoLoginActiveSlot', v);
    },
    [persist]
  );

  const updateAutoLoginCharacters = useCallback(
    (v: [CharacterProfile | null, CharacterProfile | null]) => {
      setAutoLoginCharacters(v);
      // Persist only names to settings.json — passwords go to OS keyring
      const names: [string | null, string | null] = [v[0]?.name || null, v[1]?.name || null];
      persist('autoLoginNames', names);
      // Store/clear passwords in keyring
      for (const slot of [0, 1] as const) {
        const pw = v[slot]?.password;
        if (pw) {
          storePassword(slot, pw);
        } else {
          deletePassword(slot);
        }
      }
    },
    [persist, storePassword, deletePassword]
  );

  const updateLastLoginTimestamp = useCallback(
    (v: number | null) => {
      setLastLoginTimestamp(v);
      persist('lastLoginTimestamp', v);
    },
    [persist]
  );

  const updateLastLoginSlot = useCallback(
    (v: 0 | 1 | null) => {
      setLastLoginSlot(v);
      persist('lastLoginSlot', v);
    },
    [persist]
  );

  const toggleChatNotification = useCallback(
    async (type: keyof ChatFilters) => {
      // On web, request browser notification permission when enabling for the first time
      const current = chatNotifications[type];
      if (!current && getPlatform() === 'web') {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          const result = await Notification.requestPermission();
          if (result !== 'granted') return;
        }
      }
      setChatNotifications((prev) => {
        const next = { ...prev, [type]: !prev[type] };
        persist('chatNotifications', next);
        return next;
      });
    },
    [persist, chatNotifications]
  );

  return {
    // Anti-idle
    antiIdleEnabled,
    antiIdleCommand,
    antiIdleMinutes,
    updateAntiIdleEnabled,
    updateAntiIdleCommand,
    updateAntiIdleMinutes,
    // Alignment tracking
    alignmentTrackingEnabled,
    alignmentTrackingMinutes,
    updateAlignmentTrackingEnabled,
    updateAlignmentTrackingMinutes,
    // Output transforms
    boardDatesEnabled,
    stripPromptsEnabled,
    updateBoardDatesEnabled,
    updateStripPromptsEnabled,
    // Buffer sizes
    terminalScrollback,
    commandHistorySize,
    chatHistorySize,
    updateTerminalScrollback,
    updateCommandHistorySize,
    updateChatHistorySize,
    // Timestamp
    timestampFormat,
    updateTimestampFormat,
    // Command echo
    commandEchoEnabled,
    updateCommandEchoEnabled,
    // Timer badges
    showTimerBadges,
    updateShowTimerBadges,
    // Session logging
    sessionLoggingEnabled,
    updateSessionLoggingEnabled,
    // Numpad
    numpadMappings,
    updateNumpadMappings,
    // Backups
    autoBackupEnabled,
    updateAutoBackupEnabled,
    // Notifications
    chatNotifications,
    updateChatNotifications,
    toggleChatNotification,
    // Custom chimes
    customChime1,
    customChime2,
    updateCustomChime1,
    updateCustomChime2,
    // Counter thresholds
    counterHotThreshold,
    counterColdThreshold,
    updateCounterHotThreshold,
    updateCounterColdThreshold,
    // Help guide
    hasSeenGuide,
    updateHasSeenGuide,
    // Action blocking
    actionBlockingEnabled,
    updateActionBlockingEnabled,
    // Who list
    whoAutoRefreshEnabled,
    whoRefreshMinutes,
    updateWhoAutoRefreshEnabled,
    updateWhoRefreshMinutes,
    // Gag groups
    gagGroups,
    updateGagGroups,
    // Babel language trainer
    babelEnabled,
    babelLanguage,
    babelIntervalSeconds,
    babelPhrases,
    updateBabelEnabled,
    updateBabelLanguage,
    updateBabelIntervalSeconds,
    updateBabelPhrases,
    // Post-sync commands
    postSyncEnabled,
    postSyncCommands,
    updatePostSyncEnabled,
    updatePostSyncCommands,
    // Auto-login
    autoLoginEnabled,
    autoLoginActiveSlot,
    autoLoginCharacters,
    lastLoginTimestamp,
    lastLoginSlot,
    updateAutoLoginEnabled,
    updateAutoLoginActiveSlot,
    updateAutoLoginCharacters,
    updateLastLoginTimestamp,
    updateLastLoginSlot,
  };
}
