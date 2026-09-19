import { useEffect, useRef } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';

const configKey = (char: string) => `config:${char}`;

interface ConfigurableEngine<C> {
  configure(config: C): void;
  onConfigChange: ((config: C) => void) | null;
}

/**
 * Keeps an engine's config per character. Loads the active character's config
 * into the engine when the character changes and writes it back whenever the
 * engine reports an edit. `sanitize` turns whatever is on disk (or nothing)
 * into a valid config.
 */
export function useEngineConfig<C>(
  dataStore: DataStore,
  activeCharacter: string | null,
  engine: ConfigurableEngine<C>,
  file: string,
  sanitize: (raw: Partial<C> | null | undefined) => C
) {
  /** Character key the engine's in-memory config belongs to. */
  const configCharRef = useRef<string | null>(null);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const sanitizeRef = useRef(sanitize);
  sanitizeRef.current = sanitize;

  const charKey = activeCharacter ? activeCharacter.toLowerCase() : null;

  // Persist edits. Edits made before a character is known stay in memory
  // only; they'd have nobody to belong to.
  useEffect(() => {
    engine.onConfigChange = (config) => {
      const char = configCharRef.current;
      if (!char) return;
      const ds = dataStoreRef.current;
      ds.set(file, configKey(char), config)
        .then(() => ds.save(file))
        .catch((e) => console.error(`Failed to persist ${file}:`, e));
    };
    return () => {
      engine.onConfigChange = null;
    };
  }, [engine, file]);

  // Load the active character's config, swapping it when the character changes.
  useEffect(() => {
    if (!dataStore.ready) return;
    const ds = dataStoreRef.current;

    configCharRef.current = null;
    if (!charKey) return;

    let cancelled = false;
    (async () => {
      let config: C;
      try {
        config = sanitizeRef.current(await ds.get<Partial<C>>(file, configKey(charKey)));
      } catch (e) {
        console.error(`Failed to load ${file}:`, e);
        config = sanitizeRef.current(null);
      }
      if (cancelled) return;
      engine.configure(config);
      configCharRef.current = charKey;
    })();

    return () => {
      cancelled = true;
    };
  }, [dataStore.ready, charKey, engine, file]);
}
