import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import { getPlatform } from '../lib/platform';
import type { ChatFilters } from '../types/chat';
import { DEFAULT_GAG_GROUPS, type GagGroupSettings } from '../lib/gagPatterns';
import type { AnnounceMode } from '../types';
import type { CustomSoundEntry } from './useSoundLibrary';

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
  NumpadDivide: '/counter info',
  NumpadMultiply: '/counter toggle',
  NumpadSubtract: '/movemode',
  NumpadDecimal: 'survey',
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

  // Custom sound library (user-uploaded sounds beyond the built-in chimes)
  const [customSounds, setCustomSounds] = useState<CustomSoundEntry[]>([]);

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
  const [gaggedNpcs, setGaggedNpcs] = useState<string[]>([]);

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

  // Command separator
  const [commandSeparator, setCommandSeparator] = useState(';;');

  // Select-on-send
  const [selectOnSend, setSelectOnSend] = useState(false);

  // Show skill counts on readouts
  const [showSkillCounts, setShowSkillCounts] = useState(false);

  // Mobile companion
  const [companionEnabled, setCompanionEnabled] = useState(false);
  const [companionPort, setCompanionPort] = useState(3333);

  // Collapsed groups in trigger/alias panels
  const [collapsedTriggerGroups, setCollapsedTriggerGroups] = useState<string[]>(['Gags']);
  const [collapsedAliasGroups, setCollapsedAliasGroups] = useState<string[]>([]);

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

  // Load from settings — batch-load helper avoids repetitive get→set boilerplate
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      /** Load a single setting: get from store, apply setter if valid. */
      async function load<T>(
        key: string,
        setter: React.Dispatch<React.SetStateAction<T>>,
        validate?: (v: T) => boolean,
      ): Promise<void> {
        const saved = await dataStore.get<T>(SETTINGS_FILE, key);
        if (saved != null && (validate ? validate(saved as T) : true)) setter(saved as T);
      }

      /** Load a setting where `undefined` means "not set" but `null` is a valid value. */
      async function loadNullable<T>(
        key: string,
        setter: React.Dispatch<React.SetStateAction<T>>,
      ): Promise<void> {
        const saved = await dataStore.get<T>(SETTINGS_FILE, key);
        if (saved !== undefined) setter(saved as T);
      }

      /** Load an object setting with type guard. */
      async function loadObject<T extends object>(
        key: string,
        setter: React.Dispatch<React.SetStateAction<T>>,
      ): Promise<void> {
        const saved = await dataStore.get<T>(SETTINGS_FILE, key);
        if (saved != null && typeof saved === 'object' && !Array.isArray(saved)) setter(saved);
      }

      // Boolean settings (no validation needed)
      await load('antiIdleEnabled', setAntiIdleEnabled);
      await load('boardDatesEnabled', setBoardDatesEnabled);
      await load('stripPromptsEnabled', setStripPromptsEnabled);
      await load('antiSpamEnabled', setAntiSpamEnabled);
      await load('commandEchoEnabled', setCommandEchoEnabled);
      await load('showTimerBadges', setShowTimerBadges);
      await load('sessionLoggingEnabled', setSessionLoggingEnabled);
      await load('autoBackupEnabled', setAutoBackupEnabled);
      await load('hasSeenGuide', setHasSeenGuide);
      await load('actionBlockingEnabled', setActionBlockingEnabled);
      await load('whoAutoRefreshEnabled', setWhoAutoRefreshEnabled);
      await load('babelEnabled', setBabelEnabled);
      await load('selectOnSend', setSelectOnSend);
      await load('showSkillCounts', setShowSkillCounts);
      await load('companionEnabled', setCompanionEnabled);
      await load('companionPort', setCompanionPort);
      await load('postSyncEnabled', setPostSyncEnabled);
      await load('autoLoginEnabled', setAutoLoginEnabled);
      await load('alignmentTrackingEnabled', setAlignmentTrackingEnabled);

      // String settings
      await load('antiIdleCommand', setAntiIdleCommand);
      await load('autoConcAction', setAutoConcAction);
      await load('babelLanguage', setBabelLanguage);
      await load('postSyncCommands', setPostSyncCommands);
      await load('casterWeightItem', setCasterWeightItem);
      await load('casterWeightContainer', setCasterWeightContainer);
      await load('announceMode', setAnnounceMode);
      await load('announcePetMode', setAnnouncePetMode);
      await load('commandSeparator', setCommandSeparator, (v) => v.length > 0);
      await load('timestampFormat', setTimestampFormat, (v) => v === '12h' || v === '24h');

      // Number settings (with min/max validation)
      await load('antiIdleMinutes', setAntiIdleMinutes);
      await load('alignmentTrackingMinutes', setAlignmentTrackingMinutes);
      await load('terminalScrollback', setTerminalScrollback, (v) => v >= 1000);
      await load('commandHistorySize', setCommandHistorySize, (v) => v >= 50);
      await load('chatHistorySize', setChatHistorySize, (v) => v >= 50);
      await load('counterHotThreshold', setCounterHotThreshold, (v) => v >= 0);
      await load('counterColdThreshold', setCounterColdThreshold, (v) => v >= 0);
      await load('whoRefreshMinutes', setWhoRefreshMinutes, (v) => v >= 1);
      await load('whoFontSize', setWhoFontSize, (v) => v >= 8 && v <= 18);
      await load('chatFontSize', setChatFontSize, (v) => v >= 8 && v <= 18);
      await load('babelIntervalSeconds', setBabelIntervalSeconds, (v) => v >= 10);
      await load('casterWeightAdjustUp', setCasterWeightAdjustUp, (v) => v >= 1);
      await load('casterWeightAdjustDown', setCasterWeightAdjustDown, (v) => v >= 1);

      // Object / array settings
      await loadObject('numpadMappings', setNumpadMappings);
      await loadObject('chatNotifications', setChatNotifications);
      await load('gagGroups', setGagGroups);
      await load('gaggedNpcs', setGaggedNpcs, (v) => Array.isArray(v));
      await load('babelPhrases', setBabelPhrases, (v) => Array.isArray(v) && v.length > 0);
      await load('collapsedTriggerGroups', setCollapsedTriggerGroups, (v) => Array.isArray(v));
      await load('collapsedAliasGroups', setCollapsedAliasGroups, (v) => Array.isArray(v));

      // Nullable settings (null is a valid stored value)
      await loadNullable('customChime1', setCustomChime1);
      await loadNullable('customChime2', setCustomChime2);

      // Custom sounds
      await load('customSounds', setCustomSounds, (v) => Array.isArray(v));
      await loadNullable('lastLoginTimestamp', setLastLoginTimestamp);

      // Auto-login slot (strict enum validation)
      await load('autoLoginActiveSlot', setAutoLoginActiveSlot, (v) => v === 0 || v === 1);
      const savedLastLoginSlot = await dataStore.get<number | null>(SETTINGS_FILE, 'lastLoginSlot');
      if (savedLastLoginSlot === 0 || savedLastLoginSlot === 1 || savedLastLoginSlot === null) {
        setLastLoginSlot(savedLastLoginSlot as 0 | 1 | null);
      }

      // Auto-login characters (names from settings, passwords from OS keyring)
      const savedNames = await dataStore.get<[string | null, string | null]>(
        SETTINGS_FILE,
        'autoLoginNames'
      );
      if (Array.isArray(savedNames) && savedNames.length === 2) {
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
      updateCustomSounds: make(setCustomSounds, 'customSounds'),
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
      updateGaggedNpcs: make(setGaggedNpcs, 'gaggedNpcs'),
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
      // Command separator
      updateCommandSeparator: make(setCommandSeparator, 'commandSeparator'),
      // Select-on-send
      updateSelectOnSend: make(setSelectOnSend, 'selectOnSend'),
      updateShowSkillCounts: make(setShowSkillCounts, 'showSkillCounts'),
      updateCollapsedTriggerGroups: make(setCollapsedTriggerGroups, 'collapsedTriggerGroups'),
      updateCollapsedAliasGroups: make(setCollapsedAliasGroups, 'collapsedAliasGroups'),
      // Mobile companion
      updateCompanionEnabled: make(setCompanionEnabled, 'companionEnabled'),
      updateCompanionPort: make(setCompanionPort, 'companionPort'),
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

  // Clamped font-size updater factory (shared logic for who/chat font sizes)
  const makeFontSizeUpdater = useCallback(
    (setter: React.Dispatch<React.SetStateAction<number>>, key: string) =>
      (v: number) => {
        const clamped = Math.max(8, Math.min(18, v));
        setter(clamped);
        persist(key, clamped);
      },
    [persist]
  );
  const updateWhoFontSize = useMemo(() => makeFontSizeUpdater(setWhoFontSize, 'whoFontSize'), [makeFontSizeUpdater]);
  const updateChatFontSize = useMemo(() => makeFontSizeUpdater(setChatFontSize, 'chatFontSize'), [makeFontSizeUpdater]);

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

  return useMemo(() => ({
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
    // Custom chimes / sound library
    customChime1,
    customChime2,
    customSounds,
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
    gaggedNpcs,
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
    // Command separator
    commandSeparator,
    // Select-on-send
    selectOnSend,
    // Skill counts on readouts
    showSkillCounts,
    // Collapsed panel groups
    collapsedTriggerGroups,
    collapsedAliasGroups,
    // Mobile companion
    companionEnabled,
    companionPort,
    // Special updaters (have extra logic beyond simple set+persist)
    updateAlignmentTrackingEnabled,
    updateAutoLoginCharacters,
    // All simple updaters from factory
    ...updaters,
  }), [
    antiIdleEnabled, antiIdleCommand, antiIdleMinutes,
    alignmentTrackingEnabled, alignmentTrackingMinutes,
    boardDatesEnabled, stripPromptsEnabled, antiSpamEnabled,
    terminalScrollback, commandHistorySize, chatHistorySize,
    timestampFormat, commandEchoEnabled, showTimerBadges, sessionLoggingEnabled,
    numpadMappings, autoBackupEnabled,
    chatNotifications, toggleChatNotification,
    customChime1, customChime2, customSounds,
    counterHotThreshold, counterColdThreshold,
    hasSeenGuide, actionBlockingEnabled,
    whoAutoRefreshEnabled, whoRefreshMinutes, whoFontSize, updateWhoFontSize,
    chatFontSize, updateChatFontSize,
    gagGroups, gaggedNpcs, announceMode, announcePetMode,
    babelEnabled, babelLanguage, babelIntervalSeconds, babelPhrases,
    postSyncEnabled, postSyncCommands,
    autoLoginEnabled, autoLoginActiveSlot, autoLoginCharacters,
    lastLoginTimestamp, lastLoginSlot,
    casterWeightItem, casterWeightContainer, casterWeightAdjustUp, casterWeightAdjustDown,
    autoConcAction, commandSeparator, selectOnSend, showSkillCounts,
    collapsedTriggerGroups, collapsedAliasGroups,
    companionEnabled, companionPort,
    updateAlignmentTrackingEnabled, updateAutoLoginCharacters, updaters,
  ]);
}
