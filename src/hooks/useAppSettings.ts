import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import { getPlatform } from '../lib/platform';
import type { ChatFilters } from '../types/chat';
import { DEFAULT_GAG_GROUPS, type GagGroupSettings } from '../lib/gagPatterns';
import type { AnnounceMode } from '../types';

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
if (getPlatform() === 'tauri') {
  import('@tauri-apps/api/core').then((m) => {
    invoke = m.invoke;
  });
}

const SETTINGS_FILE = 'settings.json';

/** Keyring account key for a character slot */
const slotAccount = (slot: 0 | 1) => `dartmud-slot-${slot}`;

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
  const [antiSpamEnabled, setAntiSpamEnabled] = useState(false);

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

  // Who list
  const [whoAutoRefreshEnabled, setWhoAutoRefreshEnabled] = useState(true);
  const [whoRefreshMinutes, setWhoRefreshMinutes] = useState(5);
  const [whoFontSize, setWhoFontSize] = useState(11);
  const [chatFontSize, setChatFontSize] = useState(11);

  // Babel language trainer
  const [babelEnabled, setBabelEnabled] = useState(false);
  const [babelLanguage, setBabelLanguage] = useState('');
  const [babelIntervalSeconds, setBabelIntervalSeconds] = useState(30);
  const [babelPhrases, setBabelPhrases] = useState<string[]>([]);

  // Gag groups
  const [gagGroups, setGagGroups] = useState<GagGroupSettings>({ ...DEFAULT_GAG_GROUPS });

  // Announce system
  const [announceMode, setAnnounceMode] = useState<AnnounceMode>('off');
  const [announcePetMode, setAnnouncePetMode] = useState<AnnounceMode>('off');

  // Auto-caster weight mode
  const [casterWeightItem, setCasterWeightItem] = useState('tallow');
  const [casterWeightContainer, setCasterWeightContainer] = useState('bin');
  const [casterWeightAdjustUp, setCasterWeightAdjustUp] = useState(10);
  const [casterWeightAdjustDown, setCasterWeightAdjustDown] = useState(5);

  // Auto-conc
  const [autoConcAction, setAutoConcAction] = useState('');

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
      await invoke('store_credential', { account: slotAccount(slot), password });
    } catch (e) {
      console.error('Failed to store credential:', e);
    }
  }, []);

  const deletePassword = useCallback(async (slot: 0 | 1) => {
    if (!invoke) return;
    try {
      await invoke('delete_credential', { account: slotAccount(slot) });
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
      const savedAntiSpam = await dataStore.get<boolean>(SETTINGS_FILE, 'antiSpamEnabled');
      if (savedAntiSpam != null) setAntiSpamEnabled(savedAntiSpam);

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
      const savedWhoFontSize = await dataStore.get<number>(SETTINGS_FILE, 'whoFontSize');
      if (savedWhoFontSize != null && savedWhoFontSize >= 8 && savedWhoFontSize <= 18)
        setWhoFontSize(savedWhoFontSize);
      const savedChatFontSize = await dataStore.get<number>(SETTINGS_FILE, 'chatFontSize');
      if (savedChatFontSize != null && savedChatFontSize >= 8 && savedChatFontSize <= 18)
        setChatFontSize(savedChatFontSize);

      const savedGagGroups = await dataStore.get<GagGroupSettings>(SETTINGS_FILE, 'gagGroups');
      if (savedGagGroups) setGagGroups(savedGagGroups);

      // Announce
      const savedAnnounceMode = await dataStore.get<AnnounceMode>(SETTINGS_FILE, 'announceMode');
      if (savedAnnounceMode) setAnnounceMode(savedAnnounceMode);
      const savedAnnouncePetMode = await dataStore.get<AnnounceMode>(SETTINGS_FILE, 'announcePetMode');
      if (savedAnnouncePetMode) setAnnouncePetMode(savedAnnouncePetMode);

      // Auto-caster weight mode
      const savedCasterWeightItem = await dataStore.get<string | null>(SETTINGS_FILE, 'casterWeightItem');
      if (savedCasterWeightItem) setCasterWeightItem(savedCasterWeightItem);
      const savedCasterWeightContainer = await dataStore.get<string>(SETTINGS_FILE, 'casterWeightContainer');
      if (savedCasterWeightContainer) setCasterWeightContainer(savedCasterWeightContainer);
      const savedCasterWeightAdjustUp = await dataStore.get<number>(SETTINGS_FILE, 'casterWeightAdjustUp');
      if (savedCasterWeightAdjustUp != null && savedCasterWeightAdjustUp >= 1)
        setCasterWeightAdjustUp(savedCasterWeightAdjustUp);
      const savedCasterWeightAdjustDown = await dataStore.get<number>(SETTINGS_FILE, 'casterWeightAdjustDown');
      if (savedCasterWeightAdjustDown != null && savedCasterWeightAdjustDown >= 1)
        setCasterWeightAdjustDown(savedCasterWeightAdjustDown);

      // Auto-conc
      const savedAutoConcAction = await dataStore.get<string>(SETTINGS_FILE, 'autoConcAction');
      if (savedAutoConcAction != null) setAutoConcAction(savedAutoConcAction);

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
                pw = (await invoke('get_credential', { account: slotAccount(slot) })) as
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

  /* ── Change handlers ──────────────────────────────────── */

  // Factory for simple "set state + persist" updaters (stable via useMemo)
  const updaters = useMemo(() => {
    const make = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, key: string) =>
      (v: T) => { setter(v); persist(key, v); };
    return {
      // Anti-idle
      updateAntiIdleEnabled: make(setAntiIdleEnabled, 'antiIdleEnabled'),
      updateAntiIdleCommand: make(setAntiIdleCommand, 'antiIdleCommand'),
      updateAntiIdleMinutes: make(setAntiIdleMinutes, 'antiIdleMinutes'),
      // Alignment tracking
      updateAlignmentTrackingMinutes: make(setAlignmentTrackingMinutes, 'alignmentTrackingMinutes'),
      // Output transforms
      updateBoardDatesEnabled: make(setBoardDatesEnabled, 'boardDatesEnabled'),
      updateStripPromptsEnabled: make(setStripPromptsEnabled, 'stripPromptsEnabled'),
      updateAntiSpamEnabled: make(setAntiSpamEnabled, 'antiSpamEnabled'),
      // Buffer sizes
      updateTerminalScrollback: make(setTerminalScrollback, 'terminalScrollback'),
      updateCommandHistorySize: make(setCommandHistorySize, 'commandHistorySize'),
      updateChatHistorySize: make(setChatHistorySize, 'chatHistorySize'),
      // Timestamp / echo / badges / logging
      updateTimestampFormat: make<TimestampFormat>(setTimestampFormat, 'timestampFormat'),
      updateCommandEchoEnabled: make(setCommandEchoEnabled, 'commandEchoEnabled'),
      updateShowTimerBadges: make(setShowTimerBadges, 'showTimerBadges'),
      updateSessionLoggingEnabled: make(setSessionLoggingEnabled, 'sessionLoggingEnabled'),
      // Numpad / backups
      updateNumpadMappings: make(setNumpadMappings, 'numpadMappings'),
      updateAutoBackupEnabled: make(setAutoBackupEnabled, 'autoBackupEnabled'),
      // Notifications / chimes
      updateChatNotifications: make(setChatNotifications, 'chatNotifications'),
      updateCustomChime1: make(setCustomChime1, 'customChime1'),
      updateCustomChime2: make(setCustomChime2, 'customChime2'),
      // Counter thresholds
      updateCounterHotThreshold: make(setCounterHotThreshold, 'counterHotThreshold'),
      updateCounterColdThreshold: make(setCounterColdThreshold, 'counterColdThreshold'),
      // Help guide / action blocking
      updateHasSeenGuide: make(setHasSeenGuide, 'hasSeenGuide'),
      updateActionBlockingEnabled: make(setActionBlockingEnabled, 'actionBlockingEnabled'),
      // Who list
      updateWhoAutoRefreshEnabled: make(setWhoAutoRefreshEnabled, 'whoAutoRefreshEnabled'),
      updateWhoRefreshMinutes: make(setWhoRefreshMinutes, 'whoRefreshMinutes'),
      // Gag groups
      updateGagGroups: make(setGagGroups, 'gagGroups'),
      // Announce
      updateAnnounceMode: make<AnnounceMode>(setAnnounceMode, 'announceMode'),
      updateAnnouncePetMode: make<AnnounceMode>(setAnnouncePetMode, 'announcePetMode'),
      // Babel
      updateBabelEnabled: make(setBabelEnabled, 'babelEnabled'),
      updateBabelLanguage: make(setBabelLanguage, 'babelLanguage'),
      updateBabelIntervalSeconds: make(setBabelIntervalSeconds, 'babelIntervalSeconds'),
      updateBabelPhrases: make(setBabelPhrases, 'babelPhrases'),
      // Post-sync
      updatePostSyncEnabled: make(setPostSyncEnabled, 'postSyncEnabled'),
      updatePostSyncCommands: make(setPostSyncCommands, 'postSyncCommands'),
      // Auto-login
      updateAutoLoginEnabled: make(setAutoLoginEnabled, 'autoLoginEnabled'),
      updateAutoLoginActiveSlot: make<0 | 1>(setAutoLoginActiveSlot, 'autoLoginActiveSlot'),
      updateLastLoginTimestamp: make(setLastLoginTimestamp, 'lastLoginTimestamp'),
      updateLastLoginSlot: make<0 | 1 | null>(setLastLoginSlot, 'lastLoginSlot'),
      // Auto-caster weight mode
      updateCasterWeightItem: make<string>(setCasterWeightItem, 'casterWeightItem'),
      updateCasterWeightContainer: make(setCasterWeightContainer, 'casterWeightContainer'),
      updateCasterWeightAdjustUp: make(setCasterWeightAdjustUp, 'casterWeightAdjustUp'),
      updateCasterWeightAdjustDown: make(setCasterWeightAdjustDown, 'casterWeightAdjustDown'),
      // Auto-conc
      updateAutoConcAction: make(setAutoConcAction, 'autoConcAction'),
    };
  }, [persist]);

  // Special updaters with extra logic (can't use the factory)

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

  const updateWhoFontSize = useCallback(
    (v: number) => {
      const clamped = Math.max(8, Math.min(18, v));
      setWhoFontSize(clamped);
      persist('whoFontSize', clamped);
    },
    [persist]
  );

  const updateChatFontSize = useCallback(
    (v: number) => {
      const clamped = Math.max(8, Math.min(18, v));
      setChatFontSize(clamped);
      persist('chatFontSize', clamped);
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

  const chatNotificationsRef = useRef(chatNotifications);
  chatNotificationsRef.current = chatNotifications;
  const toggleChatNotification = useCallback(
    async (type: keyof ChatFilters) => {
      // On web, request browser notification permission when enabling for the first time
      if (!chatNotificationsRef.current[type] && getPlatform() === 'web') {
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
    [persist]
  );

  return {
    // Anti-idle
    antiIdleEnabled,
    antiIdleCommand,
    antiIdleMinutes,
    // Alignment tracking
    alignmentTrackingEnabled,
    alignmentTrackingMinutes,
    // Output transforms
    boardDatesEnabled,
    stripPromptsEnabled,
    antiSpamEnabled,
    // Buffer sizes
    terminalScrollback,
    commandHistorySize,
    chatHistorySize,
    // Timestamp
    timestampFormat,
    // Command echo
    commandEchoEnabled,
    // Timer badges
    showTimerBadges,
    // Session logging
    sessionLoggingEnabled,
    // Numpad
    numpadMappings,
    // Backups
    autoBackupEnabled,
    // Notifications
    chatNotifications,
    toggleChatNotification,
    // Custom chimes
    customChime1,
    customChime2,
    // Counter thresholds
    counterHotThreshold,
    counterColdThreshold,
    // Help guide
    hasSeenGuide,
    // Action blocking
    actionBlockingEnabled,
    // Who list
    whoAutoRefreshEnabled,
    whoRefreshMinutes,
    whoFontSize,
    updateWhoFontSize,
    chatFontSize,
    updateChatFontSize,
    // Gag groups
    gagGroups,
    // Announce
    announceMode,
    announcePetMode,
    // Babel language trainer
    babelEnabled,
    babelLanguage,
    babelIntervalSeconds,
    babelPhrases,
    // Post-sync commands
    postSyncEnabled,
    postSyncCommands,
    // Auto-login
    autoLoginEnabled,
    autoLoginActiveSlot,
    autoLoginCharacters,
    lastLoginTimestamp,
    lastLoginSlot,
    // Auto-caster weight mode
    casterWeightItem,
    casterWeightContainer,
    casterWeightAdjustUp,
    casterWeightAdjustDown,
    // Auto-conc
    autoConcAction,
    // Special updaters (have extra logic beyond simple set+persist)
    updateAlignmentTrackingEnabled,
    updateAutoLoginCharacters,
    // All simple updaters from factory
    ...updaters,
  };
}
