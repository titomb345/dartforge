import { useEffect, useRef } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';
import { DEFAULT_CASTER_CONFIG, type AutoCaster, type AutoCasterConfig } from '../lib/autoCaster';

const CONFIG_FILE = 'autocast.json';
const SETTINGS_FILE = 'settings.json';
const configKey = (char: string) => `config:${char}`;

/**
 * Pre-1.17 keys in settings.json — the weight settings used to be shared by
 * every character (and the power steps weren't saved at all). A character
 * with no config of its own starts from these, so upgrading doesn't cost
 * anyone the item and container they had set up.
 */
const LEGACY_KEYS = {
  weightItem: 'casterWeightItem',
  weightContainer: 'casterWeightContainer',
  weightAdjustUp: 'casterWeightAdjustUp',
  weightAdjustDown: 'casterWeightAdjustDown',
} as const;

function sanitize(raw: Partial<AutoCasterConfig> | null | undefined): AutoCasterConfig {
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback;
  const d = DEFAULT_CASTER_CONFIG;
  const item =
    typeof raw?.weightItem === 'string' && raw.weightItem.trim() ? raw.weightItem : d.weightItem;
  const container =
    raw?.weightContainer === null
      ? null
      : typeof raw?.weightContainer === 'string'
        ? raw.weightContainer.trim() || null
        : d.weightContainer;
  return {
    adjustUp: num(raw?.adjustUp, d.adjustUp),
    adjustDown: num(raw?.adjustDown, d.adjustDown),
    weightItem: item,
    weightContainer: container,
    weightAdjustUp: num(raw?.weightAdjustUp, d.weightAdjustUp),
    weightAdjustDown: num(raw?.weightAdjustDown, d.weightAdjustDown),
  };
}

/**
 * Keeps the auto-caster's tuning (power steps, weight item/container/steps)
 * per character. Loads the active character's config into the caster when the
 * character changes and writes it back whenever a /autocast adjust|set|clear
 * command edits it.
 */
export function useAutoCasterConfig(
  dataStore: DataStore,
  activeCharacter: string | null,
  caster: AutoCaster
) {
  /** Character key the caster's in-memory config belongs to. */
  const configCharRef = useRef<string | null>(null);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;

  const charKey = activeCharacter ? activeCharacter.toLowerCase() : null;

  // Persist edits. Edits made before a character is known stay in memory
  // only; they'd have nobody to belong to.
  useEffect(() => {
    caster.onConfigChange = (config) => {
      const char = configCharRef.current;
      if (!char) return;
      const ds = dataStoreRef.current;
      ds.set(CONFIG_FILE, configKey(char), config)
        .then(() => ds.save(CONFIG_FILE))
        .catch((e) => console.error('Failed to persist autocast config:', e));
    };
    return () => {
      caster.onConfigChange = null;
    };
  }, [caster]);

  // Load the active character's config, swapping it when the character changes.
  useEffect(() => {
    if (!dataStore.ready) return;
    const ds = dataStoreRef.current;

    configCharRef.current = null;
    if (!charKey) return;

    let cancelled = false;
    (async () => {
      let config: AutoCasterConfig;
      try {
        const saved = await ds.get<Partial<AutoCasterConfig>>(CONFIG_FILE, configKey(charKey));
        if (saved != null) {
          config = sanitize(saved);
        } else {
          // First time this character autocasts since the upgrade: start
          // from the old shared weight settings if there are any.
          const legacy: Partial<AutoCasterConfig> = {};
          const item = await ds.get<string>(SETTINGS_FILE, LEGACY_KEYS.weightItem);
          if (typeof item === 'string') legacy.weightItem = item;
          const container = await ds.get<string>(SETTINGS_FILE, LEGACY_KEYS.weightContainer);
          if (typeof container === 'string') legacy.weightContainer = container || null;
          const up = await ds.get<number>(SETTINGS_FILE, LEGACY_KEYS.weightAdjustUp);
          if (typeof up === 'number') legacy.weightAdjustUp = up;
          const down = await ds.get<number>(SETTINGS_FILE, LEGACY_KEYS.weightAdjustDown);
          if (typeof down === 'number') legacy.weightAdjustDown = down;
          config = sanitize(legacy);
          if (cancelled) return;
          await ds.set(CONFIG_FILE, configKey(charKey), config);
          await ds.save(CONFIG_FILE);
        }
      } catch (e) {
        console.error('Failed to load autocast config:', e);
        config = { ...DEFAULT_CASTER_CONFIG };
      }
      if (cancelled) return;
      caster.configure(config);
      configCharRef.current = charKey;
    })();

    return () => {
      cancelled = true;
    };
  }, [dataStore.ready, charKey, caster]);
}
