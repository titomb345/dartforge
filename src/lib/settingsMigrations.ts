import type { DataStore } from '../contexts/DataStoreContext';

export const CURRENT_VERSION = 12;

/** Raw store contents — all keys are optional since older stores may lack them. */
export type StoreData = Record<string, unknown>;

type MigrationFn = (data: StoreData) => StoreData;

/**
 * Ordered migration functions. MIGRATIONS[n] migrates version n → n+1.
 * The v0→v1 migration is a no-op — it just stamps the version on pre-versioning installs.
 */
const MIGRATIONS: MigrationFn[] = [
  // v0 → v1: no-op, stamps _version on existing installs
  (data) => data,
  // v1 → v2: initialize skill tracking settings
  (data) => {
    if (!('activeCharacter' in data)) {
      data.activeCharacter = null;
    }
    if (!('showInlineImproves' in data)) {
      data.showInlineImproves = false;
    }
    return data;
  },
  // v2 → v3: initialize compact mode setting
  (data) => {
    if (!('compactMode' in data)) {
      data.compactMode = false;
    }
    return data;
  },
  // v3 → v4: per-status filtering replaces compact mode toggle
  (data) => {
    const wasCompact = data.compactMode === true;
    delete data.compactMode;
    data.compactBar = false;
    data.filteredStatuses = {
      concentration: wasCompact,
      hunger: wasCompact,
      thirst: wasCompact,
      aura: wasCompact,
      encumbrance: wasCompact,
      movement: wasCompact,
    };
    return data;
  },
  // v4 → v5: initialize panel docking layout
  (data) => {
    if (!('panelLayout' in data)) {
      data.panelLayout = { left: [], right: [] };
    }
    return data;
  },
  // v5 → v6: initialize chat panel settings
  (data) => {
    if (!('chatMutedSenders' in data)) {
      data.chatMutedSenders = [];
    }
    if (!('chatFilters' in data)) {
      data.chatFilters = {
        say: false,
        shout: false,
        ooc: true,
        tell: true,
        sz: true,
      };
    }
    return data;
  },
  // v6 → v7: initialize counter period length setting
  (data) => {
    if (!('counterPeriodLength' in data)) {
      data.counterPeriodLength = 10;
    }
    return data;
  },
  // v7 → v8: replace global compactBar with per-readout compactReadouts
  (data) => {
    const wasCompact = data.compactBar === true;
    delete data.compactBar;
    data.compactReadouts = {
      health: wasCompact,
      concentration: wasCompact,
      aura: wasCompact,
      hunger: wasCompact,
      thirst: wasCompact,
      encumbrance: wasCompact,
      movement: wasCompact,
      clock: false,
    };
    return data;
  },
  // v8 → v9: initialize alias settings
  (data) => {
    // globalAliases moved from settings.json to aliases.json — clean up if present
    delete data.globalAliases;
    if (!('enableSpeedwalk' in data)) {
      data.enableSpeedwalk = true;
    }
    return data;
  },
  // v9 → v10: initialize chat sound alert settings
  (data) => {
    if (!('chatSoundAlerts' in data)) {
      data.chatSoundAlerts = {
        say: true,
        shout: true,
        ooc: true,
        tell: true,
        sz: true,
      };
    }
    return data;
  },
  // v10 → v11: initialize trigger system settings
  (data) => {
    if (!('triggersEnabled' in data)) {
      data.triggersEnabled = true;
    }
    return data;
  },
  // v11 → v12: initialize anti-idle settings
  (data) => {
    if (!('antiIdleEnabled' in data)) {
      data.antiIdleEnabled = false;
    }
    if (!('antiIdleCommand' in data)) {
      data.antiIdleCommand = 'hp';
    }
    if (!('antiIdleMinutes' in data)) {
      data.antiIdleMinutes = 10;
    }
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
      console.error(`Settings migration v${v}→v${v + 1} returned invalid data, aborting migrations`);
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
