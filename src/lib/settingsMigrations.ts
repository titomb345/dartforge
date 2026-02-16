import type { Store } from '@tauri-apps/plugin-store';

export const CURRENT_VERSION = 2;

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
];

/**
 * Read the store's `_version`, run any pending migrations sequentially,
 * then write the updated `_version` back.
 */
export async function migrateSettings(store: Store): Promise<void> {
  const version = (await store.get<number>('_version')) ?? 0;

  if (version >= CURRENT_VERSION) return;

  // Snapshot all keys we care about into a plain object
  let data: StoreData = {};
  for (const key of await store.keys()) {
    data[key] = await store.get(key);
  }

  // Run each migration sequentially
  for (let v = version; v < CURRENT_VERSION; v++) {
    data = MIGRATIONS[v](data);
  }

  // Write migrated values back
  for (const [key, value] of Object.entries(data)) {
    await store.set(key, value);
  }

  await store.set('_version', CURRENT_VERSION);
  await store.save();
}
