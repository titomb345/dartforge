import type { DataStore } from '../contexts/DataStoreContext';

/**
 * Settings schema version — one version per release.
 *
 * v0 → v1: v1.0 launch baseline
 * v1 → v2: v1.3 release (alignment, post-sync, timers, auto-login, action blocking,
 *           who refresh, gag groups, announce, caster weight, auto-conc, chat, map)
 * v2 → v3: v1.4 release (numpad operator keys, command separator)
 * v3 → v4: v1.5 release (select-on-send)
 * v4 → v5: v1.6 release (show skill counts, NPC gags)
 *
 * Prior to this collapse, each feature had its own version bump (up to v17).
 * normalizeVersion() maps those old version numbers to the collapsed scheme.
 */
export const CURRENT_VERSION = 5;

/** Raw store contents — all keys are optional since older stores may lack them. */
export type StoreData = Record<string, unknown>;

type MigrationFn = (data: StoreData) => StoreData;

/**
 * Map old per-feature version numbers to the collapsed per-release scheme.
 * All migrations use `if (!('key' in data))` guards, so re-running a
 * collapsed migration on a user who had some (but not all) of its keys
 * is safe — it only fills in the missing ones.
 */
function normalizeVersion(v: number): number {
  if (v <= 1) return v; // v0 = fresh install, v1 = v1.0 user
  if (v <= 13) return 1; // dev builds between v1.0–v1.3: re-run v1.3 migration (idempotent)
  if (v <= 15) return 2; // v14 = v1.3 user, v15 = dev build before v1.4
  if (v === 16) return 3; // v1.4 user
  return CURRENT_VERSION; // v17+ = already current or beta normalization
}

/**
 * Ordered migration functions. MIGRATIONS[n] migrates version n → n+1.
 */
const MIGRATIONS: MigrationFn[] = [
  // ── v0 → v1: v1.0 launch baseline ──────────────────────────────────
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

  // ── v1 → v2: v1.3 release ──────────────────────────────────────────
  (data) => {
    // Alignment tracking
    if (!('alignmentTrackingEnabled' in data)) data.alignmentTrackingEnabled = false;
    if (!('alignmentTrackingMinutes' in data)) data.alignmentTrackingMinutes = 5;

    // Post-sync commands
    if (!('postSyncEnabled' in data)) data.postSyncEnabled = false;
    if (!('postSyncCommands' in data)) data.postSyncCommands = '';

    // Timers
    if (!('timersEnabled' in data)) data.timersEnabled = true;
    if (!('showTimerBadges' in data)) data.showTimerBadges = true;

    // Auto-login character profiles (passwords stored in OS keyring)
    if (!('autoLoginEnabled' in data)) data.autoLoginEnabled = false;
    if (!('autoLoginActiveSlot' in data)) data.autoLoginActiveSlot = 0;
    if (!('autoLoginNames' in data)) data.autoLoginNames = [null, null];
    if (!('lastLoginTimestamp' in data)) data.lastLoginTimestamp = null;
    if (!('lastLoginSlot' in data)) data.lastLoginSlot = null;
    delete data.autoLoginCharacters;

    // Action blocking / command queueing
    if (!('actionBlockingEnabled' in data)) data.actionBlockingEnabled = true;

    // Who list auto-refresh
    if (!('whoAutoRefreshEnabled' in data)) data.whoAutoRefreshEnabled = true;
    if (!('whoRefreshMinutes' in data)) data.whoRefreshMinutes = 5;

    // Gag groups
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

    // Who list font size
    if (!('whoFontSize' in data)) data.whoFontSize = 11;

    // Announce system
    if (!('announceMode' in data)) data.announceMode = 'off';
    if (!('announcePetMode' in data)) data.announcePetMode = 'off';

    // Auto-caster weight mode
    if (!('casterWeightItem' in data)) data.casterWeightItem = 'tallow';
    if (!('casterWeightContainer' in data)) data.casterWeightContainer = 'bin';
    if (!('casterWeightAdjustUp' in data)) data.casterWeightAdjustUp = 10;
    if (!('casterWeightAdjustDown' in data)) data.casterWeightAdjustDown = 5;

    // Auto-conc action
    if (!('autoConcAction' in data)) data.autoConcAction = '';

    // Hide own chat messages
    if (!('chatHideOwnMessages' in data)) data.chatHideOwnMessages = true;

    // Map fingerprint schema upgrade
    data.mapSchemaVersion = 3;

    return data;
  },

  // ── v2 → v3: v1.4 release ──────────────────────────────────────────
  (data) => {
    // Add configurable numpad operator keys
    const mappings = data.numpadMappings as Record<string, string> | undefined;
    if (mappings && typeof mappings === 'object') {
      if (!('NumpadDivide' in mappings)) mappings.NumpadDivide = '/counter info';
      if (!('NumpadMultiply' in mappings)) mappings.NumpadMultiply = '/counter toggle';
      if (!('NumpadSubtract' in mappings)) mappings.NumpadSubtract = '/movemode';
      if (!('NumpadDecimal' in mappings)) mappings.NumpadDecimal = 'survey';
    }

    // Configurable command separator (existing users keep `;` for backward compat)
    if (!('commandSeparator' in data)) data.commandSeparator = ';';

    return data;
  },

  // ── v3 → v4: v1.5 release ──────────────────────────────────────────
  (data) => {
    // Select-on-send (keep last command selected in input after sending)
    if (!('selectOnSend' in data)) data.selectOnSend = false;

    // Macros (keyboard hotkey → command sequences)
    if (!('macros' in data)) data.macros = [];

    // Collapsed panel groups
    if (!('collapsedTriggerGroups' in data)) data.collapsedTriggerGroups = ['Gags'];
    if (!('collapsedAliasGroups' in data)) data.collapsedAliasGroups = [];

    return data;
  },

  // ── v4 → v5: v1.6 release ──────────────────────────────────────────
  (data) => {
    // Show skill counts on readouts
    if (!('showSkillCounts' in data)) data.showSkillCounts = false;

    // NPC speech gags (user-managed name list)
    if (!('gaggedNpcs' in data)) data.gaggedNpcs = [];

    return data;
  },
];

const SETTINGS_FILE = 'settings.json';

/**
 * Read the settings `_version`, run any pending migrations sequentially,
 * then write the updated `_version` back.
 */
export async function migrateSettings(dataStore: DataStore): Promise<void> {
  const rawVersion = (await dataStore.get<number>(SETTINGS_FILE, '_version')) ?? 0;
  const version = normalizeVersion(rawVersion);

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
