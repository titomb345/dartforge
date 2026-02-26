import type { DataStore } from '../contexts/DataStoreContext';

/**
 * Settings schema version.
 *
 * v1.0 launch reset: collapsed 20 pre-release migrations into a single
 * baseline. Existing beta users (version > 1) are normalized to 1 so
 * future migrations apply correctly to everyone.
 */
export const CURRENT_VERSION = 11;

/** Raw store contents — all keys are optional since older stores may lack them. */
export type StoreData = Record<string, unknown>;

type MigrationFn = (data: StoreData) => StoreData;

/**
 * Ordered migration functions. MIGRATIONS[n] migrates version n → n+1.
 */
const MIGRATIONS: MigrationFn[] = [
  // v0 → v1: Baseline defaults for v1.0 launch
  // Sets all settings to their default values if not already present.
  (data) => {
    // Skill tracking
    if (!('activeCharacter' in data)) data.activeCharacter = null;
    if (!('showInlineImproves' in data)) data.showInlineImproves = false;

    // Status bar filtering & compact readouts
    if (!('filteredStatuses' in data)) {
      data.filteredStatuses = {
        concentration: false,
        hunger: false,
        thirst: false,
        aura: false,
        encumbrance: false,
        movement: false,
      };
    }
    if (!('compactReadouts' in data)) {
      data.compactReadouts = {
        health: false,
        concentration: false,
        aura: false,
        hunger: false,
        thirst: false,
        encumbrance: false,
        movement: false,
        clock: false,
      };
    }
    if (!('statusBarOrder' in data)) {
      data.statusBarOrder = [
        'health',
        'concentration',
        'aura',
        'hunger',
        'thirst',
        'encumbrance',
        'movement',
      ];
    }

    // Panel docking
    if (!('panelLayout' in data)) data.panelLayout = { left: [], right: [] };
    if (!('pinnedWidths' in data)) data.pinnedWidths = { left: 320, right: 320 };

    // Chat
    if (!('chatMutedSenders' in data)) data.chatMutedSenders = [];
    if (!('chatFilters' in data)) {
      data.chatFilters = { say: false, shout: false, ooc: true, tell: true, sz: true };
    }
    if (!('chatSoundAlerts' in data)) {
      data.chatSoundAlerts = { say: true, shout: true, ooc: true, tell: true, sz: true };
    }
    if (!('chatNotifications' in data)) {
      data.chatNotifications = { say: false, shout: false, ooc: false, tell: false, sz: false };
    }

    // Counters
    if (!('counterPeriodLength' in data)) data.counterPeriodLength = 10;

    // Aliases & triggers
    if (!('enableSpeedwalk' in data)) data.enableSpeedwalk = true;
    if (!('triggersEnabled' in data)) data.triggersEnabled = true;
    // Clean up legacy key if present
    delete data.globalAliases;

    // Anti-idle
    if (!('antiIdleEnabled' in data)) data.antiIdleEnabled = false;
    if (!('antiIdleCommand' in data)) data.antiIdleCommand = 'hp';
    if (!('antiIdleMinutes' in data)) data.antiIdleMinutes = 10;

    // Output transforms
    if (!('boardDatesEnabled' in data)) data.boardDatesEnabled = false;
    if (!('stripPromptsEnabled' in data)) data.stripPromptsEnabled = false;

    // Map
    if (!('mapSchemaVersion' in data)) data.mapSchemaVersion = 2;

    // Buffer sizes
    if (!('terminalScrollback' in data)) data.terminalScrollback = 10000;
    if (!('commandHistorySize' in data)) data.commandHistorySize = 500;
    if (!('chatHistorySize' in data)) data.chatHistorySize = 500;

    // Display
    if (!('timestampFormat' in data)) data.timestampFormat = '12h';
    if (!('commandEchoEnabled' in data)) data.commandEchoEnabled = false;

    // Session logging
    if (!('sessionLoggingEnabled' in data)) data.sessionLoggingEnabled = false;

    // Numpad
    if (!('numpadMappings' in data)) {
      data.numpadMappings = {
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
    }

    // Backups
    if (!('autoBackupEnabled' in data)) data.autoBackupEnabled = true;

    // Custom chimes
    if (!('customChime1' in data)) data.customChime1 = null;
    if (!('customChime2' in data)) data.customChime2 = null;

    // Help guide
    if (!('hasSeenGuide' in data)) data.hasSeenGuide = false;

    // Clean up obsolete keys from pre-release migrations
    delete data.compactMode;
    delete data.compactBar;

    return data;
  },
  // v1 → v2: Alignment tracking
  (data) => {
    if (!('alignmentTrackingEnabled' in data)) data.alignmentTrackingEnabled = false;
    if (!('alignmentTrackingMinutes' in data)) data.alignmentTrackingMinutes = 5;
    return data;
  },
  // v2 → v3: Post-sync commands
  (data) => {
    if (!('postSyncEnabled' in data)) data.postSyncEnabled = false;
    if (!('postSyncCommands' in data)) data.postSyncCommands = '';
    return data;
  },
  // v3 → v4: Timers
  (data) => {
    if (!('timersEnabled' in data)) data.timersEnabled = true;
    if (!('showTimerBadges' in data)) data.showTimerBadges = true;
    return data;
  },
  // v4 → v5: Auto-login character profiles (passwords stored in OS keyring, not here)
  (data) => {
    if (!('autoLoginEnabled' in data)) data.autoLoginEnabled = false;
    if (!('autoLoginActiveSlot' in data)) data.autoLoginActiveSlot = 0;
    if (!('autoLoginNames' in data)) data.autoLoginNames = [null, null];
    if (!('lastLoginTimestamp' in data)) data.lastLoginTimestamp = null;
    if (!('lastLoginSlot' in data)) data.lastLoginSlot = null;
    // Clean up legacy key if it was stored during development
    delete data.autoLoginCharacters;
    return data;
  },
  // v5 → v6: Action blocking / command queueing
  (data) => {
    if (!('actionBlockingEnabled' in data)) data.actionBlockingEnabled = true;
    return data;
  },
  // v6 → v7: Who list auto-refresh
  (data) => {
    if (!('whoAutoRefreshEnabled' in data)) data.whoAutoRefreshEnabled = true;
    if (!('whoRefreshMinutes' in data)) data.whoRefreshMinutes = 5;
    return data;
  },
  // v7 → v8: Gag groups
  (data) => {
    if (!('gagGroups' in data)) {
      data.gagGroups = {
        pets: false,
        creatures: false,
        citizens: false,
        trainers: false,
        sparring: false,
        channels: false,
        quests: false,
      };
    }
    return data;
  },
  // v8 → v9: Who list font size
  (data) => {
    if (!('whoFontSize' in data)) data.whoFontSize = 11;
    return data;
  },
  // v9 → v10: Announce system
  (data) => {
    if (!('announceMode' in data)) data.announceMode = 'off';
    if (!('announcePetMode' in data)) data.announcePetMode = 'off';
    return data;
  },
  // v10 → v11: Auto-caster weight mode settings
  (data) => {
    if (!('casterWeightItem' in data)) data.casterWeightItem = 'tallow';
    if (!('casterWeightContainer' in data)) data.casterWeightContainer = 'bin';
    if (!('casterWeightAdjustUp' in data)) data.casterWeightAdjustUp = 10;
    if (!('casterWeightAdjustDown' in data)) data.casterWeightAdjustDown = 5;
    return data;
  },
];

const SETTINGS_FILE = 'settings.json';

/**
 * Read the settings `_version`, run any pending migrations sequentially,
 * then write the updated `_version` back.
 */
export async function migrateSettings(dataStore: DataStore): Promise<void> {
  const version = (await dataStore.get<number>(SETTINGS_FILE, '_version')) ?? 0;

  // v1.0 reset: beta users had version 2–20 from pre-release migrations.
  // Normalize them to CURRENT_VERSION so future migrations apply correctly.
  if (version > CURRENT_VERSION) {
    await dataStore.set(SETTINGS_FILE, '_version', CURRENT_VERSION);
    await dataStore.save(SETTINGS_FILE);
    return; // existing user, already has all settings
  }

  if (version >= CURRENT_VERSION) return;

  // Snapshot all keys into a plain object
  let data: StoreData = {};
  for (const key of await dataStore.keys(SETTINGS_FILE)) {
    data[key] = await dataStore.get(SETTINGS_FILE, key);
  }

  // Run each migration sequentially
  for (let v = version; v < CURRENT_VERSION; v++) {
    const result = MIGRATIONS[v](data);
    if (result == null || typeof result !== 'object') {
      console.error(
        `Settings migration v${v}→v${v + 1} returned invalid data, aborting migrations`
      );
      break;
    }
    data = result;
  }

  // Write migrated values back
  for (const [key, value] of Object.entries(data)) {
    await dataStore.set(SETTINGS_FILE, key, value);
  }

  await dataStore.set(SETTINGS_FILE, '_version', CURRENT_VERSION);
  await dataStore.save(SETTINGS_FILE);
}
